'use strict';

/**
 * Tools available to the Generate Agent.
 *
 * Same safety rule as tools/imageAgentTools.js: nothing here writes to
 * ScripturaSettings. `propose_content_defaults` only returns a
 * `{type:'proposed_change', ...}` diff; the only writer is the
 * POST /agents/settings/apply controller.
 *
 * These are GLOBAL baselines, not per-blog overrides — services/generation.js
 * only falls back to them when a blog's own wizard config and any confirmed
 * per-blog brand voice are both silent on a given field (see
 * resolveContentDefaults() there for the exact precedence).
 */

const { POINTS_OF_VIEW, READABILITY_LEVELS } = require('../../../constants');
const styleProfile = require('../styleProfile');

/** scriptura_settings key holding the global content defaults. */
const CONTENT_DEFAULTS_KEY = 'agents.generate.content_defaults';

const FIELDS = ['tone_of_voice', 'point_of_view', 'readability_level', 'extra_notes'];

const proposeContentDefaults = {
  name: 'propose_content_defaults',
  description:
    'Propose new global defaults for future article generation — tone of voice, point of view, ' +
    'readability level, and/or free-form extra style guidance. Only proposes a diff for the admin ' +
    'to review; never applies it. These are a BASELINE — an author who explicitly set one of these ' +
    'in the wizard for a specific article still wins over this default for that article.',
  input_schema: {
    type: 'object',
    properties: {
      tone_of_voice: {
        type: 'string',
        description: 'Short free-text description of tone, e.g. "warm and reassuring" or "highly professional".',
      },
      point_of_view: {
        type: 'string',
        enum: POINTS_OF_VIEW,
        description: 'Default narrative point of view for future articles.',
      },
      readability_level: {
        type: 'string',
        enum: READABILITY_LEVELS,
        description: 'Default reading level for future articles.',
      },
      extra_notes: {
        type: 'string',
        description: 'Any additional free-form style guidance to append to every future article prompt.',
      },
    },
  },
  async execute(args = {}) {
    const proposed = {};
    for (const field of FIELDS) {
      if (typeof args[field] === 'string' && args[field].trim()) {
        proposed[field] = args[field].trim();
      }
    }
    if (Object.keys(proposed).length === 0) {
      throw new Error('At least one of tone_of_voice, point_of_view, readability_level, or extra_notes is required.');
    }
    if (proposed.tone_of_voice && proposed.tone_of_voice.length > 255) {
      throw new Error('tone_of_voice must be at most 255 characters.');
    }
    if (proposed.extra_notes && proposed.extra_notes.length > 2000) {
      throw new Error('extra_notes must be at most 2000 characters.');
    }

    const { ScripturaSettings } = require('../../../models');
    const current = (await ScripturaSettings.getValue(CONTENT_DEFAULTS_KEY, { fallback: {} })) || {};

    return {
      type: 'proposed_change',
      change: {
        key: CONTENT_DEFAULTS_KEY,
        current_value: current,
        proposed_value: proposed,
      },
      message: 'Proposed new content defaults — nothing has been applied yet. The admin needs to hit Apply.',
    };
  },
};

const getCurrentContentDefaults = {
  name: 'get_current_content_defaults',
  description: "Read the platform's current global content defaults (tone, POV, readability, extra notes), so you can answer questions or decide what to propose.",
  input_schema: { type: 'object', properties: {} },
  async execute() {
    const { ScripturaSettings } = require('../../../models');
    const current = (await ScripturaSettings.getValue(CONTENT_DEFAULTS_KEY, { fallback: {} })) || {};
    return { type: 'read', current };
  },
};

const startStyleProfileExtraction = {
  name: 'start_style_profile_extraction',
  description:
    'Analyse up to 20 example articles (existing blog IDs and/or pasted text) and extract a ' +
    'structured style profile (tone, point of view, traits, summary) — a "learn our house style ' +
    'from these examples" feature. Returns a DRAFT only; it is never persisted or applied by this ' +
    'tool. A separate explicit confirm action (not a tool you have) is required before it can ' +
    'influence future generation — tell the admin to review the draft and confirm it themselves.',
  input_schema: {
    type: 'object',
    properties: {
      blog_ids: {
        type: 'array',
        items: { type: 'integer' },
        description: 'IDs of existing blogs whose published copy should teach the style.',
      },
      raw_samples: {
        type: 'array',
        items: { type: 'string' },
        description: 'Freeform pasted text samples (e.g. copy from outside the platform) to teach the style.',
      },
    },
  },
  async execute({ blog_ids = [], raw_samples = [] } = {}) {
    const result = await styleProfile.extractStyleProfile({ blogIds: blog_ids, rawSamples: raw_samples });
    return { type: 'style_profile_draft', ...result };
  },
};

const getCurrentStyleProfile = {
  name: 'get_current_style_profile',
  description:
    "Read the platform's current CONFIRMED style profile, if one exists (unconfirmed drafts are not " +
    'persisted, so this only ever returns a profile a human has already reviewed and confirmed).',
  input_schema: { type: 'object', properties: {} },
  async execute() {
    const { ScripturaSettings } = require('../../../models');
    const current = await ScripturaSettings.getValue(styleProfile.STYLE_PROFILE_KEY, { fallback: null });
    return { type: 'read', current };
  },
};

module.exports = {
  CONTENT_DEFAULTS_KEY,
  TOOLS: [proposeContentDefaults, getCurrentContentDefaults, startStyleProfileExtraction, getCurrentStyleProfile],
};
