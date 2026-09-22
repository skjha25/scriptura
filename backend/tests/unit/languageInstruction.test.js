// backend/tests/unit/languageInstruction.test.js
'use strict';

/**
 * Part A (language) regression coverage.
 *
 * resolveLanguageInstruction is the single place that maps a stored
 * `blog.language` value to the actual instruction sent to the model — see
 * services/ai/prompts.js's own header comment on why every supported
 * language gets an explicit, named instruction rather than relying on the
 * model to infer a language from its ISO code alone.
 */

const { LANGUAGES } = require('../../src/constants');
const { resolveLanguageInstruction, articlePrompt } = require('../../src/services/ai/prompts');

describe('resolveLanguageInstruction', () => {
  it('returns null for English (no instruction needed, matches pre-change behavior)', () => {
    expect(resolveLanguageInstruction('en')).toBeNull();
    expect(resolveLanguageInstruction(undefined)).toBeNull();
    expect(resolveLanguageInstruction(null)).toBeNull();
  });

  it('gives Hindi an explicit, named instruction', () => {
    expect(resolveLanguageInstruction('hi')).toMatch(/ISO code "hi" \(Hindi\)/);
  });

  it('gives Gujarati an explicit, named instruction', () => {
    expect(resolveLanguageInstruction('gu')).toMatch(/ISO code "gu" \(Gujarati\)/);
  });

  it('every non-English supported language has its own named instruction, not the bare ISO fallback', () => {
    LANGUAGES.filter((code) => code !== 'en').forEach((code) => {
      const instruction = resolveLanguageInstruction(code);
      expect(instruction).toMatch(/^Write in the language with ISO code "\w+" \(\w+\)\.$/);
    });
  });

  it('falls back to the generic sentence for an unrecognised code (no invented behavior)', () => {
    expect(resolveLanguageInstruction('fr')).toBe('Write in the language with ISO code "fr".');
  });
});

describe('articlePrompt language wiring', () => {
  it('includes no language directive when language is English', () => {
    const prompt = articlePrompt({ topic: 'Mercury retrograde', language: 'en' });
    expect(prompt).not.toMatch(/Write in/);
  });

  it('includes the Hindi directive when language is hi', () => {
    const prompt = articlePrompt({ topic: 'Mercury retrograde', language: 'hi' });
    expect(prompt).toMatch(/Write in the language with ISO code "hi" \(Hindi\)/);
  });

  it('includes the Gujarati directive when language is gu', () => {
    const prompt = articlePrompt({ topic: 'Mercury retrograde', language: 'gu' });
    expect(prompt).toMatch(/Write in the language with ISO code "gu" \(Gujarati\)/);
  });
});
