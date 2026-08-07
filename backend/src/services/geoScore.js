'use strict';

/**
 * Generative Engine Optimization (GEO) scoring.
 *
 * ---------------------------------------------------------------------------
 * WHAT GEO MEANS HERE
 * ---------------------------------------------------------------------------
 * GEO is about being cited or quoted by generative AI chat engines — ChatGPT,
 * Perplexity, Gemini, Claude — when a user asks a question the article answers.
 * This is a different game from both SEO and AEO: the Princeton/KDD study
 * (arXiv:2311.09735, 10,000 queries) found that keyword density and simplified
 * language do NOT help citation odds, while five specific tactics give a
 * 30-41% lift: citing sources, quoting named experts, including sourced
 * statistics, writing fluently, and using an authoritative (non-hedging) voice.
 * Crucially, the lift is *larger* for lower-ranked/smaller sites — GEO rewards
 * claim-level credibility, not domain authority, which is exactly the lever a
 * single-organisation site like Divinetalk can pull.
 *
 * Same design rules as seoScore.js / aeoScore.js on purpose:
 *   1. Pure heuristic, no AI call — deterministic and explainable.
 *   2. Every criterion returns its own points/max/met/detail row.
 *   3. Every weight is a named constant carrying its own justification.
 *
 * Weights sum to exactly 100, asserted by a unit test mirroring seoScore's.
 */

const { blocksToPlainText, countWords } = require('./blocksToHtml');

// ===========================================================================
// WEIGHTS — total 100
// ===========================================================================

/**
 * INLINE_CITATIONS (25) — the single strongest signal in the Princeton study
 *   (+30-40%, and +115% for lower-ranked sites specifically). An external link
 *   attached to a claim is the clearest machine-checkable proxy for "this
 *   assertion is sourced" available to a heuristic scorer.
 *
 * STATISTICS_WITH_SOURCES (20) — a close second in the same study (+30-41%).
 *   Detected as a number co-occurring with a source/attribution cue in the
 *   same sentence — "68% of respondents (Pew Research, 2024)" — rather than a
 *   bare digit, which would reward noise.
 *
 * EXPERT_QUOTATIONS (15) — named, attributed quotes measurably lift citation
 *   odds. Scored from `quote` blocks with an attribution field, which the
 *   editor already supports natively.
 *
 * AUTHORITATIVE_VOICE (15) — the ratio of hedge words (arguably, possibly,
 *   might, could, seems) to total sentences. AI training data skews toward
 *   confident, declarative prose; heavy hedging reads as low-confidence and is
 *   penalised in the underlying study.
 *
 * ANSWER_FRONT_LOADING (10) — ChatGPT/Perplexity weight content in the first
 *   ~150 words heavily; an article that buries its point loses citation share
 *   even if the rest is excellent.
 *
 * ENTITY_RICHNESS (10) — named people, texts, places and dates per 500 words.
 *   Generative engines cite content that reads as specific and encyclopaedic
 *   over content that reads as generic filler.
 *
 * WORD_COUNT_FLOOR (5) — thin content is not cited; 1800 words is the
 *   research-cited floor for GEO specifically (higher than the SEO floor,
 *   which optimises for a different, shorter-form surface). Lowest weight
 *   because it is a gate, not a spectrum — once past it, more length adds
 *   little further GEO value.
 */
const GEO_WEIGHTS = Object.freeze({
  INLINE_CITATIONS: 25,
  STATISTICS_WITH_SOURCES: 20,
  EXPERT_QUOTATIONS: 15,
  AUTHORITATIVE_VOICE: 15,
  ANSWER_FRONT_LOADING: 10,
  ENTITY_RICHNESS: 10,
  WORD_COUNT_FLOOR: 5,
});

// ===========================================================================
// Bands and vocabularies
// ===========================================================================

/** GEO's word-count floor. Higher than SEO's because AI engines favour depth. */
const GEO_WORD_COUNT_FLOOR = 1800;

/** Words within this many chars of the article start are "front-loaded". */
const FRONT_LOAD_WORDS = 150;

/** Hedge words/phrases — their presence signals a non-authoritative voice. */
const HEDGE_WORDS = Object.freeze([
  'arguably', 'possibly', 'perhaps', 'might', 'may', 'could', 'seems',
  'appears to', 'somewhat', 'relatively', 'in some cases', 'it is thought',
  'some believe', 'reportedly', 'allegedly', 'presumably',
]);

/** Cues that a number is attributed to a source (co-occurring in a sentence). */
const SOURCE_CUES = Object.freeze([
  'according to', 'study', 'research', 'survey', 'report', 'data from',
  'source:', 'per ', 'cited by', 'published',
]);

/** Named entities relevant to Divinetalk's domain — classical texts and figures. */
const DOMAIN_ENTITY_HINTS = Object.freeze([
  'brihat parashara hora shastra', 'jaimini', 'vedic', 'nakshatra', 'rashi',
  'purana', 'veda', 'upanishad', 'muhurat', 'panchang', 'jyotish',
]);

// ===========================================================================
// Shared helpers (mirrors seoScore.js row()/totalOf())
// ===========================================================================

function row(criterion, max, ratio, detail, met) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const points = Math.round(max * clamped);
  return {
    criterion,
    points,
    max,
    met: met === undefined ? points === max : met,
    detail,
  };
}

function totalOf(breakdown) {
  return breakdown.reduce((sum, item) => sum + item.points, 0);
}

/** Splits plain text into naive sentences for hedge/statistic proximity checks. */
function splitSentences(text) {
  return String(text ?? '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Counts <a href> occurrences inside paragraph/list/quote block text (HTML-aware). */
function countInlineCitations(blocks) {
  let count = 0;
  const externalHrefPattern = /<a\s[^>]*href=["']https?:\/\/[^"']+["'][^>]*>/gi;
  for (const block of blocks) {
    const html = block?.data?.html || '';
    const text = block?.data?.text || '';
    const haystack = `${html} ${text}`;
    const matches = haystack.match(externalHrefPattern);
    if (matches) count += matches.length;
  }
  return count;
}

/** Counts sentences containing both a digit and a source-attribution cue. */
function countSourcedStatistics(plainText) {
  const sentences = splitSentences(plainText);
  const lower = sentences.map((s) => s.toLowerCase());
  let count = 0;
  for (let i = 0; i < sentences.length; i += 1) {
    const hasNumber = /\d/.test(sentences[i]);
    const hasCue = SOURCE_CUES.some((cue) => lower[i].includes(cue));
    if (hasNumber && hasCue) count += 1;
  }
  return count;
}

function countHedgeWords(plainText) {
  const lower = String(plainText ?? '').toLowerCase();
  return HEDGE_WORDS.reduce((sum, phrase) => {
    const pattern = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    return sum + (lower.match(pattern) || []).length;
  }, 0);
}

function countEntityHints(plainText) {
  const lower = String(plainText ?? '').toLowerCase();
  // Capitalised multi-word sequences in the original text as a generic
  // named-entity proxy (people, places, titles), plus domain-specific hints.
  const capitalisedSequences = (plainText.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g) || []).length;
  const domainHits = DOMAIN_ENTITY_HINTS.reduce(
    (sum, term) => sum + (lower.includes(term) ? 1 : 0),
    0
  );
  return capitalisedSequences + domainHits;
}

// ===========================================================================
// Main scoring function
// ===========================================================================

/**
 * Scores an article's Generative Engine Optimization (AI-citation) readiness.
 *
 * @param {object} options
 * @param {Array} options.blocks - content_blocks array.
 * @returns {{score: number|null, breakdown: Array}}
 */
function scoreArticle({ blocks } = {}) {
  const blockList = Array.isArray(blocks) ? blocks.filter(Boolean) : [];
  if (blockList.length === 0) {
    return { score: null, breakdown: [] };
  }

  const breakdown = [];
  const bodyText = blocksToPlainText(blockList);
  const totalWords = countWords(blockList);

  // --- Inline citations ------------------------------------------------------
  const citationCount = countInlineCitations(blockList);
  const citationsPer1000Words = totalWords > 0 ? (citationCount / totalWords) * 1000 : 0;
  // 2+ citations per 1000 words is a reasonable well-sourced target.
  const citationRatio = Math.min(1, citationsPer1000Words / 2);
  breakdown.push(
    row(
      'INLINE_CITATIONS',
      GEO_WEIGHTS.INLINE_CITATIONS,
      citationRatio,
      citationCount === 0
        ? 'No inline citations to external sources. This is the strongest single signal for AI-engine citation (Princeton study: +30-40%, up to +115% for smaller sites).'
        : `${citationCount} inline citation(s) to external sources (~${citationsPer1000Words.toFixed(1)} per 1000 words).`
    )
  );

  // --- Statistics with sources -------------------------------------------------
  const statCount = countSourcedStatistics(bodyText);
  breakdown.push(
    row(
      'STATISTICS_WITH_SOURCES',
      GEO_WEIGHTS.STATISTICS_WITH_SOURCES,
      statCount >= 3 ? 1 : statCount >= 1 ? 0.5 : 0,
      statCount === 0
        ? 'No sourced statistics detected (a number plus an attribution cue like "according to" or "study"). Sourced stats give a measurable AI-citation lift.'
        : `${statCount} sourced statistic(s) detected.${statCount < 3 ? ' Three or more strengthens claim-level credibility.' : ''}`
    )
  );

  // --- Expert quotations ---------------------------------------------------
  const quoteBlocks = blockList.filter((b) => b.type === 'quote');
  const attributedQuotes = quoteBlocks.filter((b) => String(b.data?.attribution || '').trim() !== '');
  breakdown.push(
    row(
      'EXPERT_QUOTATIONS',
      GEO_WEIGHTS.EXPERT_QUOTATIONS,
      attributedQuotes.length >= 2 ? 1 : attributedQuotes.length >= 1 ? 0.6 : 0,
      attributedQuotes.length === 0
        ? 'No attributed expert quotations. A named quote (name + credential) is one of the five tactics proven to lift AI-citation odds.'
        : `${attributedQuotes.length} attributed quotation(s) present.`
    )
  );

  // --- Authoritative voice (hedge word ratio) -------------------------------
  const sentences = splitSentences(bodyText);
  const hedgeCount = countHedgeWords(bodyText);
  const hedgeRatioPer100 = sentences.length > 0 ? (hedgeCount / sentences.length) * 100 : 0;
  // 0 hedges per 100 sentences = full marks; 15+ per 100 = zero.
  const voiceRatio = Math.max(0, 1 - hedgeRatioPer100 / 15);
  breakdown.push(
    row(
      'AUTHORITATIVE_VOICE',
      GEO_WEIGHTS.AUTHORITATIVE_VOICE,
      voiceRatio,
      hedgeCount === 0
        ? 'No hedge words detected (arguably, possibly, might, ...) — reads as confident and declarative, which the research favours.'
        : `${hedgeCount} hedge word(s) across ${sentences.length} sentence(s). Confident, declarative statements are cited more often than hedged ones.`
    )
  );

  // --- Answer front-loading --------------------------------------------------
  const firstWords = bodyText.split(/\s+/).filter(Boolean).slice(0, FRONT_LOAD_WORDS).join(' ');
  const firstWordCount = firstWords.split(/\s+/).filter(Boolean).length;
  const hasSubstance = firstWordCount >= Math.min(FRONT_LOAD_WORDS, 60);
  breakdown.push(
    row(
      'ANSWER_FRONT_LOADING',
      GEO_WEIGHTS.ANSWER_FRONT_LOADING,
      hasSubstance ? 1 : firstWordCount / 60,
      hasSubstance
        ? `First ${FRONT_LOAD_WORDS} words carry substantial content — ChatGPT and Perplexity weight this window heavily when selecting citations.`
        : `Only ${firstWordCount} word(s) of real content in the opening ${FRONT_LOAD_WORDS}-word window. Front-load the core answer.`
    )
  );

  // --- Entity richness ---------------------------------------------------------
  const entityHints = countEntityHints(bodyText);
  const entitiesPer500 = totalWords > 0 ? (entityHints / totalWords) * 500 : 0;
  const entityRatio = Math.min(1, entitiesPer500 / 5);
  breakdown.push(
    row(
      'ENTITY_RICHNESS',
      GEO_WEIGHTS.ENTITY_RICHNESS,
      entityRatio,
      `~${entitiesPer500.toFixed(1)} named entities (people, texts, places) per 500 words.${
        entitiesPer500 < 5 ? ' Generative engines favour specific, entity-rich content over generic prose.' : ''
      }`
    )
  );

  // --- Word count floor ----------------------------------------------------
  breakdown.push(
    row(
      'WORD_COUNT_FLOOR',
      GEO_WEIGHTS.WORD_COUNT_FLOOR,
      Math.min(1, totalWords / GEO_WORD_COUNT_FLOOR),
      totalWords >= GEO_WORD_COUNT_FLOOR
        ? `${totalWords} words — past the ${GEO_WORD_COUNT_FLOOR}-word floor below which generative engines rarely cite an article.`
        : `${totalWords} words — below the ${GEO_WORD_COUNT_FLOOR}-word floor research associates with AI-engine citation.`
    )
  );

  return { score: totalOf(breakdown), breakdown };
}

module.exports = {
  scoreArticle,
  GEO_WEIGHTS,
  GEO_WORD_COUNT_FLOOR,
  FRONT_LOAD_WORDS,
  HEDGE_WORDS,
  SOURCE_CUES,
};
