'use strict';

/**
 * Bulk style-profile extraction — the "teach it from 10-20 example blogs"
 * feature for the Generate Agent.
 *
 * A new sibling to services/brandVoice.js rather than an extension of it:
 * brandVoice.js is scoped to ONE sample -> ONE voice -> ONE blog's
 * `brand_voice_confirmed` column. This is N samples -> ONE global profile ->
 * gated by a `confirmed` flag inside a ScripturaSettings JSON value, not a DB
 * column. Both follow the same shape on purpose (extract -> cap token spend
 * -> call the provider -> tolerant parse -> never auto-confirm), and this
 * file directly reuses brandVoice's response parser rather than duplicating
 * it — a style profile IS a brand voice, just learned from many examples
 * instead of one.
 */

const ApiError = require('../../utils/ApiError');
const prompts = require('../ai/prompts');
const { getTextProvider } = require('../ai');
const { toPlainText } = require('../sanitize');
const { parseBrandVoiceResponse } = require('../brandVoice');

/** scriptura_settings key holding the confirmed global style profile. */
const STYLE_PROFILE_KEY = 'agents.generate.style_profile';

/** Bounded the same way a single admin request should be — not a bulk import tool. */
const MAX_SAMPLES = 20;

/**
 * Collects plain-text samples from existing blog rows and/or pasted text.
 * @returns {Promise<string[]>}
 */
async function gatherSamples({ blogIds = [], rawSamples = [] }) {
  const parts = [];

  if (blogIds.length) {
    const { Blog } = require('../../models');
    const rows = await Blog.findAll({
      where: { id: blogIds },
      attributes: ['id', 'blog_content'],
    });
    for (const row of rows) {
      const text = toPlainText(row.blog_content || '');
      if (text) parts.push(text);
    }
  }

  for (const raw of rawSamples) {
    const text = toPlainText(String(raw || '')) || String(raw || '').replace(/\s+/g, ' ').trim();
    if (text) parts.push(text);
  }

  return parts;
}

/**
 * Analyses up to MAX_SAMPLES example articles and extracts a structured style
 * profile. Always returns `confirmed: false` — mirrors brandVoice.analyzeBrandVoice's
 * contract exactly, for the same reason: only a separate, explicit human action
 * may confirm a voice, and this function must never be the one that does it.
 *
 * @param {object} input
 * @param {number[]} [input.blogIds] Existing blog rows to learn from.
 * @param {string[]} [input.rawSamples] Freeform pasted text samples.
 * @param {object} [options]
 * @param {object} [options.provider] Text provider override, for tests.
 * @returns {Promise<{profile: {tone: string|null, pov: string|null, traits: string[], summary: string|null}, sample_count: number, confirmed: false}>}
 */
async function extractStyleProfile({ blogIds = [], rawSamples = [] } = {}, options = {}) {
  const totalRequested = blogIds.length + rawSamples.length;
  if (totalRequested === 0) {
    throw ApiError.unprocessable('Provide at least one blog_id or raw sample to learn a style from.', {
      code: 'NOTHING_TO_ANALYSE',
    });
  }
  if (totalRequested > MAX_SAMPLES) {
    throw ApiError.unprocessable(`At most ${MAX_SAMPLES} samples at a time.`, {
      code: 'TOO_MANY_SAMPLES',
      details: { requested: totalRequested, max: MAX_SAMPLES },
    });
  }

  const parts = await gatherSamples({ blogIds, rawSamples });
  if (parts.length === 0) {
    throw ApiError.unprocessable('None of the supplied samples had usable text.', { code: 'SAMPLE_EMPTY' });
  }

  // Fenced per-example so the model reads N distinct examples of the same
  // voice, not one run-on document — the same fencing habit prompts.js uses
  // for every other block of untrusted/bulk content.
  const combined = parts.map((text, index) => `--- Example ${index + 1} ---\n${text}`).join('\n\n');
  // Capped BEFORE the call, not after: the cap exists to bound token spend,
  // and truncating the response would not save anything.
  const capped = prompts.clamp(combined, prompts.BRAND_VOICE_SAMPLE_MAX_CHARS);

  // "Teach it more" should build on what it already knows, not discard it —
  // if a profile has already been confirmed, hand it to the model as context
  // so re-analysis refines/merges rather than starting from zero each time.
  const { ScripturaSettings } = require('../../models');
  const existing = await ScripturaSettings.getValue(STYLE_PROFILE_KEY, { fallback: null });
  const previousProfile = existing?.confirmed
    ? { tone: existing.tone, pov: existing.pov, traits: existing.traits, summary: existing.summary }
    : null;

  const provider = options.provider || getTextProvider();
  const response = await provider.analyzeBrandVoice({ sample: capped, previousProfile });
  const parsed = parseBrandVoiceResponse(response);

  if (!parsed.tone && parsed.traits.length === 0) {
    throw ApiError.upstream(
      'The model returned no usable style description. Try different or longer examples.',
      { code: 'UPSTREAM_BAD_RESPONSE', details: { provider: provider.name } }
    );
  }

  return {
    profile: { tone: parsed.tone, pov: parsed.pov, traits: parsed.traits, summary: parsed.summary },
    sample_count: parts.length,
    confirmed: false,
  };
}

/**
 * The ONLY function allowed to persist a style profile as confirmed/live.
 * Re-shapes and validates the profile defensively rather than trusting
 * whatever the caller (an HTTP body, ultimately admin-controlled) hands in.
 *
 * @param {{tone?: string, pov?: string, traits?: string[], summary?: string}} profile
 * @returns {Promise<object>} The persisted value.
 */
async function confirmStyleProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    throw ApiError.badRequest('A style profile is required to confirm.', { code: 'PROFILE_REQUIRED' });
  }

  const { ScripturaSettings } = require('../../models');
  const value = {
    tone: typeof profile.tone === 'string' && profile.tone.trim() ? profile.tone.trim() : null,
    pov: typeof profile.pov === 'string' && profile.pov.trim() ? profile.pov.trim() : null,
    traits: Array.isArray(profile.traits) ? profile.traits.filter((t) => typeof t === 'string') : [],
    summary: typeof profile.summary === 'string' && profile.summary.trim() ? profile.summary.trim() : null,
    confirmed: true,
    confirmed_at: new Date().toISOString(),
  };

  await ScripturaSettings.setValue(STYLE_PROFILE_KEY, value, { scope: 'org' });
  return value;
}

module.exports = {
  STYLE_PROFILE_KEY,
  MAX_SAMPLES,
  extractStyleProfile,
  confirmStyleProfile,
};
