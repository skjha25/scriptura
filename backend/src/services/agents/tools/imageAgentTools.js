'use strict';

/**
 * Tools available to the Blog Image Agent.
 *
 * Every settings-changing tool here follows one non-negotiable rule: it never
 * writes to ScripturaSettings. It only returns a `{type:'proposed_change', ...}`
 * result describing a diff. The only code path allowed to persist an agent-
 * controlled setting is the POST /agents/settings/apply controller, which
 * re-validates independently — this is what makes "nothing an agent proposes
 * auto-applies" true by construction, not just by convention.
 */

const { IMAGE_STYLES } = require('../../../constants');
const { STYLE_DIRECTIVES } = require('../../imageGeneration');

/** scriptura_settings key holding per-style directive overrides. */
const STYLE_OVERRIDES_KEY = 'agents.image.style_overrides';

const MIN_DIRECTIVE_LENGTH = 10;
const MAX_DIRECTIVE_LENGTH = 600;

const proposeImageStyleOverride = {
  name: 'propose_image_style_override',
  description:
    'Propose a new style directive for one of the 4 existing image styles (photo, illustration, ' +
    'minimal, brand_colored). This only proposes a diff for the admin to review — it never applies ' +
    'the change. Never call this to change dignity, cultural-accuracy, or no-text/no-watermark rules; ' +
    'those are fixed by the platform and are not part of this tool.',
  input_schema: {
    type: 'object',
    properties: {
      style: {
        type: 'string',
        enum: IMAGE_STYLES,
        description: 'Which of the 4 existing image styles this change applies to.',
      },
      directive_text: {
        type: 'string',
        description:
          'The new, complete style directive — concrete visual language (lighting, palette, ' +
          `composition), ${MIN_DIRECTIVE_LENGTH}-${MAX_DIRECTIVE_LENGTH} characters. This REPLACES ` +
          'the current directive for this style, so include everything that should still apply.',
      },
    },
    required: ['style', 'directive_text'],
  },
  async execute({ style, directive_text } = {}) {
    if (!IMAGE_STYLES.includes(style)) {
      throw new Error(`"${style}" is not one of the platform's image styles: ${IMAGE_STYLES.join(', ')}.`);
    }

    const text = String(directive_text || '').trim();
    if (text.length < MIN_DIRECTIVE_LENGTH || text.length > MAX_DIRECTIVE_LENGTH) {
      throw new Error(
        `directive_text must be between ${MIN_DIRECTIVE_LENGTH} and ${MAX_DIRECTIVE_LENGTH} characters.`
      );
    }

    // Lazy require: ScripturaSettings pulls in the full model registry, which
    // this module (loaded by the agent registry at boot) doesn't otherwise need.
    const { ScripturaSettings } = require('../../../models');
    const overrides = (await ScripturaSettings.getValue(STYLE_OVERRIDES_KEY, { fallback: {} })) || {};
    const currentValue = overrides[style]?.directive_text || STYLE_DIRECTIVES[style];

    return {
      type: 'proposed_change',
      change: {
        key: STYLE_OVERRIDES_KEY,
        style,
        current_value: currentValue,
        proposed_value: text,
      },
      message: `Proposed a new "${style}" directive — nothing has been applied yet. The admin needs to hit Apply.`,
    };
  },
};

const getCurrentImageSettings = {
  name: 'get_current_image_settings',
  description: "Read the platform's current image style directives (including any admin overrides already applied), so you can answer questions or decide what to propose.",
  input_schema: { type: 'object', properties: {} },
  async execute() {
    const { ScripturaSettings } = require('../../../models');
    const overrides = (await ScripturaSettings.getValue(STYLE_OVERRIDES_KEY, { fallback: {} })) || {};
    const current = Object.fromEntries(
      IMAGE_STYLES.map((style) => [style, overrides[style]?.directive_text || STYLE_DIRECTIVES[style]])
    );
    return { type: 'read', current };
  },
};

module.exports = {
  STYLE_OVERRIDES_KEY,
  MIN_DIRECTIVE_LENGTH,
  MAX_DIRECTIVE_LENGTH,
  TOOLS: [proposeImageStyleOverride, getCurrentImageSettings],
};
