'use strict';

/**
 * On-page SEO scoring.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A HEURISTIC IN CODE AND NOT AN AI CALL
 * ---------------------------------------------------------------------------
 * The spec is explicit that the score must be transparent and explainable. Three
 * consequences follow, and they are the reason this file is shaped the way it is:
 *
 *   1. Asking a model "score this article out of 100" produces a number that
 *      changes between runs on identical input and cannot be justified to the
 *      person whose article just dropped from 78 to 64. So: no AI, no network,
 *      no I/O. Pure functions of their arguments.
 *
 *   2. Every criterion returns its own `points / max / met / detail`. The editor
 *      shows that breakdown verbatim, so "why is my score 71?" is answered by
 *      the UI instead of by a support conversation.
 *
 *   3. Every weight is a named exported constant carrying the reason it is worth
 *      what it is worth. Disagreeing with a weight is then a one-line, reviewable
 *      change — which is the point of writing it down rather than burying it.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE WEIGHTS ARE AND ARE NOT
 * ---------------------------------------------------------------------------
 * They encode well-established on-page practice — keyword placement, title
 * width, content depth, heading hierarchy, alt text, meta description length.
 * They are NOT a model of Google's ranking system, which is unknowable, and a
 * 100 here does not promise a ranking. What a 100 does mean is "this article has
 * no on-page defect we know how to detect", which is the useful thing to
 * automate.
 *
 * Both weight sets sum to exactly 100, asserted by a unit test.
 */

const { blocksToPlainText, countWords } = require('./blocksToHtml');
const { toPlainText } = require('./sanitize');

// ===========================================================================
// TITLE WEIGHTS — total 100
// ===========================================================================

/**
 * Title scoring weights.
 *
 * KEYWORD_PRESENCE (25) — the single highest weight in the set. A title that
 *   does not contain the term it is targeting cannot rank for it, so this is
 *   less a "signal" than a precondition. Nothing else in the title matters as
 *   much.
 *
 * LENGTH (20) — Google truncates the SERP title at roughly 580px, about 50–60
 *   characters. A truncated title loses its ending, which is where the benefit
 *   usually sits, and a very short one wastes the slot. Second-highest because
 *   it is entirely under the author's control and trivially fixable.
 *
 * KEYWORD_POSITION (15) — front-loading the keyword measurably helps both
 *   crawler weighting and human scanning. Weighted below presence because the
 *   difference between "keyword at word 1" and "keyword at word 4" is real but
 *   small, and forcing it produces titles that read like slugs.
 *
 * POWER_WORD (15) — click-through rate is a real ranking input over time, and a
 *   title with no motivating word ("practical", "explained", "actually",
 *   "mistakes") converts poorly. Equal to position because CTR and placement
 *   trade off against each other in practice.
 *
 * READABILITY (15) — ALL-CAPS words, stacked colons and exclamation marks all
 *   depress trust for an astrology brand specifically, where the failure mode is
 *   reading as fear-selling. Weighted the same as the two above because for
 *   Divinetalk it is an editorial requirement, not a nicety.
 *
 * NUMBER_OR_YEAR (10) — the lowest weight, and deliberately so. A number or a
 *   year genuinely lifts CTR on listicles and seasonal pieces, but it is
 *   inappropriate for plenty of legitimate titles, so it should never be able to
 *   dominate the score.
 */
const TITLE_WEIGHTS = Object.freeze({
  KEYWORD_PRESENCE: 25,
  LENGTH: 20,
  KEYWORD_POSITION: 15,
  POWER_WORD: 15,
  READABILITY: 15,
  NUMBER_OR_YEAR: 10,
});

// ===========================================================================
// ARTICLE WEIGHTS — total 100
// ===========================================================================

/**
 * Article scoring weights.
 *
 * WORD_COUNT (20) — content depth is the strongest on-page correlate of ranking
 *   for informational queries, and thin content is the most common defect in
 *   AI-generated drafts. Joint highest.
 *
 * KEYWORD_DENSITY (20) — joint highest because it is the only criterion that can
 *   fail in *both* directions. Too low and the page is not about anything in
 *   particular; too high and it reads as spam and is actively penalised. Scoring
 *   a band rather than a floor is what makes the criterion honest.
 *
 * HEADING_STRUCTURE (15) — headings are how both a crawler and a scanning reader
 *   build a model of the page. A 1500-word wall with two headings is a genuine
 *   defect, not a style preference.
 *
 * SECONDARY_KEYWORDS (10) — long-tail coverage. Real value, but secondary to the
 *   primary term by definition, hence half the density weight.
 *
 * LINKS (10) — internal links distribute authority and keep readers on site;
 *   one credible external reference signals research. Both matter; neither is
 *   worth more than depth or keyword handling.
 *
 * IMAGE_ALT (10) — accessibility first and image search second. Weighted equally
 *   with links because a missing alt is a hard accessibility failure, not just a
 *   lost ranking opportunity.
 *
 * META_DESCRIPTION (10) — does not rank the page, but it is the copy that decides
 *   whether the result is clicked. Low weight because it is metadata, not content.
 *
 * FAQ (5) — the smallest weight. An FAQ block earns FAQPage structured data and
 *   is a plausible route into an AI overview or a People-Also-Ask slot, but plenty
 *   of good articles should not have one, so it stays a bonus rather than a gate.
 */
const ARTICLE_WEIGHTS = Object.freeze({
  WORD_COUNT: 20,
  KEYWORD_DENSITY: 20,
  HEADING_STRUCTURE: 15,
  SECONDARY_KEYWORDS: 10,
  LINKS: 10,
  IMAGE_ALT: 10,
  META_DESCRIPTION: 10,
  FAQ: 5,
});

// ===========================================================================
// Bands and vocabularies
// ===========================================================================

/** Title character band. 50–60 is what Google renders before truncating. */
const TITLE_LENGTH = Object.freeze({ MIN: 50, MAX: 60, ACCEPTABLE_MIN: 40, ACCEPTABLE_MAX: 70 });

/**
 * Word-count bands.
 *
 * The optimal floor is 900 rather than the often-quoted 300: Divinetalk's target
 * queries ("mangal dosha", "saturn in pisces") are informational and the pages
 * already ranking for them are long. 2000 is the practical ceiling before a
 * single article should have been two.
 */
const WORD_COUNT = Object.freeze({
  OPTIMAL_MIN: 900,
  OPTIMAL_MAX: 2000,
  ACCEPTABLE_MIN: 600,
  ACCEPTABLE_MAX: 3000,
  THIN_MIN: 300,
});

/**
 * Keyword density band, as a percentage of body words.
 *
 * 0.5–2.5% is the long-standing consensus safe range. Below 0.5% the page has no
 * clear subject; above 2.5% it starts to read as stuffed, and above
 * STUFFING_MAX it is scored as an outright defect rather than a near miss.
 */
const KEYWORD_DENSITY = Object.freeze({
  OPTIMAL_MIN: 0.5,
  OPTIMAL_MAX: 2.5,
  LOW_MIN: 0.25,
  STUFFING_MAX: 3.5,
});

/** Meta description character band. ~155 is Google's render width. */
const META_DESCRIPTION_LENGTH = Object.freeze({
  MIN: 140,
  MAX: 160,
  ACCEPTABLE_MIN: 120,
  ACCEPTABLE_MAX: 180,
  THIN_MIN: 50,
});

/** One heading per this many words is the structural target. */
const WORDS_PER_HEADING = 300;

/**
 * Power words.
 *
 * Curated for this brand rather than lifted from a generic marketing list:
 * "guaranteed", "shocking" and "miracle" are absent on purpose because they are
 * exactly the register Divinetalk's editorial rules forbid. Rewarding a word the
 * style guide bans would make the score actively harmful.
 */
const POWER_WORDS = Object.freeze([
  'actually', 'avoid', 'beginner', 'best', 'complete', 'essential', 'explained',
  'guide', 'how', 'important', 'mistakes', 'myths', 'need', 'practical', 'proven',
  'real', 'right', 'simple', 'step', 'truth', 'ultimate', 'understand', 'why',
  'without', 'worth',
]);

/** Hosts treated as our own when classifying a link. */
const INTERNAL_HOSTS = Object.freeze(['divinetalk.in', 'www.divinetalk.in']);

// ===========================================================================
// Shared helpers
// ===========================================================================

/** Normalises text for matching: lower case, collapsed whitespace. */
function normalise(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Escapes a string for literal use inside a RegExp. */
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Counts whole-phrase occurrences of `phrase` in `haystack`.
 *
 * Word-boundary anchored so "sun" does not match inside "Sunday" — an
 * unanchored count is the classic way a density heuristic silently
 * over-reports and then rewards a page for stuffing it never did.
 *
 * @param {string} haystack Normalised text.
 * @param {string} phrase Normalised phrase.
 * @returns {number}
 */
function countPhrase(haystack, phrase) {
  if (!haystack || !phrase) return 0;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}])`, 'giu');
  return (haystack.match(pattern) || []).length;
}

/** Words in a phrase; used to weight multi-word keywords in the density maths. */
function phraseWordCount(phrase) {
  return normalise(phrase).split(' ').filter(Boolean).length;
}

/**
 * One breakdown row.
 * @param {string} criterion Stable identifier, matching the weight key.
 * @param {number} max
 * @param {number} ratio 0..1 share of `max` awarded.
 * @param {string} detail Human-readable explanation, shown in the editor.
 * @param {boolean} [met] Whether the criterion is considered satisfied.
 */
function row(criterion, max, ratio, detail, met) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const points = Math.round(max * clamped);
  return {
    criterion,
    points,
    max,
    // "Met" means full marks, unless the caller overrides — a partial band is
    // informative but it is not a pass, and showing it as one would hide the
    // fixable thing.
    met: met === undefined ? points === max : met,
    detail,
  };
}

/** Sums a breakdown into a 0..100 integer. */
function totalOf(breakdown) {
  return breakdown.reduce((sum, item) => sum + item.points, 0);
}

// ===========================================================================
// Title scoring
// ===========================================================================

/**
 * Scores a blog title.
 *
 * @param {string} title
 * @param {object} [options]
 * @param {string} [options.keyword] Primary target keyword.
 * @returns {{score: number, breakdown: Array<{criterion: string, points: number, max: number, met: boolean, detail: string}>}}
 */
function scoreTitle(title, { keyword } = {}) {
  const raw = typeof title === 'string' ? title.trim() : '';
  const normalisedTitle = normalise(raw);
  const normalisedKeyword = normalise(keyword);
  const breakdown = [];

  // --- Keyword presence ----------------------------------------------------
  const exact = normalisedKeyword !== '' && countPhrase(normalisedTitle, normalisedKeyword) > 0;
  const keywordWords = normalisedKeyword.split(' ').filter(Boolean);
  const presentWords = keywordWords.filter((word) => countPhrase(normalisedTitle, word) > 0);
  const partialRatio = keywordWords.length ? presentWords.length / keywordWords.length : 0;

  if (normalisedKeyword === '') {
    breakdown.push(
      row(
        'KEYWORD_PRESENCE',
        TITLE_WEIGHTS.KEYWORD_PRESENCE,
        0,
        'No target keyword was set, so keyword placement cannot be scored. Set one on the blog to score this.',
        false
      )
    );
  } else if (exact) {
    breakdown.push(
      row('KEYWORD_PRESENCE', TITLE_WEIGHTS.KEYWORD_PRESENCE, 1, `Contains the exact keyword "${keyword}".`)
    );
  } else if (partialRatio > 0) {
    // 60% of the weight: all the right words in the wrong order still gives the
    // page a topical claim, but it will not match the phrase query.
    breakdown.push(
      row(
        'KEYWORD_PRESENCE',
        TITLE_WEIGHTS.KEYWORD_PRESENCE,
        0.6 * partialRatio,
        `Contains ${presentWords.length} of ${keywordWords.length} keyword words but not the exact phrase "${keyword}".`
      )
    );
  } else {
    breakdown.push(
      row('KEYWORD_PRESENCE', TITLE_WEIGHTS.KEYWORD_PRESENCE, 0, `Does not contain the keyword "${keyword}".`)
    );
  }

  // --- Keyword position ----------------------------------------------------
  if (exact) {
    const at = normalisedTitle.indexOf(normalisedKeyword);
    const position = normalisedTitle.length ? at / normalisedTitle.length : 1;
    // Four coarse bands rather than a continuous curve: the difference between
    // 12% and 15% through the title is noise, and a banded score is explainable.
    const ratio = position <= 0.1 ? 1 : position <= 0.3 ? 0.7 : position <= 0.5 ? 0.4 : 0.15;
    breakdown.push(
      row(
        'KEYWORD_POSITION',
        TITLE_WEIGHTS.KEYWORD_POSITION,
        ratio,
        `Keyword starts at character ${at} (${Math.round(position * 100)}% through the title). Earlier is better.`
      )
    );
  } else {
    breakdown.push(
      row(
        'KEYWORD_POSITION',
        TITLE_WEIGHTS.KEYWORD_POSITION,
        0,
        'The exact keyword is not present, so it has no position to score.',
        false
      )
    );
  }

  // --- Length --------------------------------------------------------------
  const length = raw.length;
  let lengthRatio;
  let lengthDetail;
  if (length >= TITLE_LENGTH.MIN && length <= TITLE_LENGTH.MAX) {
    lengthRatio = 1;
    lengthDetail = `${length} characters — inside the optimal ${TITLE_LENGTH.MIN}–${TITLE_LENGTH.MAX} band.`;
  } else if (length >= TITLE_LENGTH.ACCEPTABLE_MIN && length <= TITLE_LENGTH.ACCEPTABLE_MAX) {
    lengthRatio = 0.7;
    lengthDetail =
      length < TITLE_LENGTH.MIN
        ? `${length} characters — a little short. Aim for ${TITLE_LENGTH.MIN}–${TITLE_LENGTH.MAX}.`
        : `${length} characters — Google will likely truncate. Aim for ${TITLE_LENGTH.MIN}–${TITLE_LENGTH.MAX}.`;
  } else if (length >= 30 && length <= 80) {
    lengthRatio = 0.4;
    lengthDetail = `${length} characters — well outside the ${TITLE_LENGTH.MIN}–${TITLE_LENGTH.MAX} band.`;
  } else {
    lengthRatio = length === 0 ? 0 : 0.1;
    lengthDetail =
      length === 0
        ? 'The title is empty.'
        : `${length} characters — far outside the ${TITLE_LENGTH.MIN}–${TITLE_LENGTH.MAX} band.`;
  }
  breakdown.push(row('LENGTH', TITLE_WEIGHTS.LENGTH, lengthRatio, lengthDetail));

  // --- Power words ---------------------------------------------------------
  const found = POWER_WORDS.filter((word) => countPhrase(normalisedTitle, word) > 0);
  let powerRatio;
  let powerDetail;
  if (found.length === 0) {
    powerRatio = 0;
    powerDetail = 'No motivating word. Consider "practical", "explained", "mistakes", "why", "without".';
  } else if (found.length <= 2) {
    powerRatio = 1;
    powerDetail = `Uses ${found.length === 1 ? 'the power word' : 'power words'} ${found.map((w) => `"${w}"`).join(', ')}.`;
  } else {
    // Three or more starts to read as copywriting rather than as an article
    // title, which is the failure mode this brand cares about.
    powerRatio = 0.6;
    powerDetail = `Uses ${found.length} power words (${found.map((w) => `"${w}"`).join(', ')}) — one or two reads more credibly.`;
  }
  breakdown.push(row('POWER_WORD', TITLE_WEIGHTS.POWER_WORD, powerRatio, powerDetail));

  // --- Number or year ------------------------------------------------------
  const year = /\b(?:19|20)\d{2}\b/.exec(raw);
  const number = /\b\d+\b/.exec(raw);
  breakdown.push(
    row(
      'NUMBER_OR_YEAR',
      TITLE_WEIGHTS.NUMBER_OR_YEAR,
      year || number ? 1 : 0,
      year
        ? `Includes the year ${year[0]}, which helps for seasonal and dated topics.`
        : number
          ? `Includes the number ${number[0]}, which lifts click-through on list articles.`
          : 'No number or year. Optional, but both lift click-through where they fit the topic.'
    )
  );

  // --- Readability ---------------------------------------------------------
  // Four independent faults, each costing a quarter of the weight, so the detail
  // string can name exactly what to fix.
  const words = raw.split(/\s+/).filter(Boolean);
  const shouty = words.filter((w) => w.length > 2 && w === w.toUpperCase() && /[A-Z]/.test(w));
  const colons = (raw.match(/:/g) || []).length;
  const bangs = (raw.match(/[!?]/g) || []).length;
  const lowerStart = words.length > 0 && /^[a-z]/.test(words[0]);

  const faults = [];
  if (shouty.length > 0) faults.push(`${shouty.length} ALL-CAPS word${shouty.length === 1 ? '' : 's'}`);
  if (colons > 1) faults.push(`${colons} colons`);
  if (bangs > 1) faults.push(`${bangs} exclamation or question marks`);
  if (lowerStart) faults.push('does not start with a capital');

  breakdown.push(
    // An empty title has no faults to find, which would otherwise earn it full
    // readability marks and a non-zero total for having no title at all.
    words.length === 0
      ? row('READABILITY', TITLE_WEIGHTS.READABILITY, 0, 'There is no title to assess.')
      : row(
          'READABILITY',
          TITLE_WEIGHTS.READABILITY,
          1 - faults.length * 0.25,
          faults.length === 0
            ? 'Clean title case, no shouting, no stacked punctuation.'
            : `Readability issues: ${faults.join('; ')}.`
        )
  );

  return { score: totalOf(breakdown), breakdown };
}

// ===========================================================================
// Article scoring
// ===========================================================================

/** Collects every link the blocks contain, classified internal vs external. */
function collectLinks(blocks) {
  const internal = [];
  const external = [];

  const classify = (href) => {
    const url = String(href || '').trim();
    if (url === '') return;
    if (/^https?:\/\//i.test(url)) {
      const host = (/^https?:\/\/([^/?#]+)/i.exec(url) || [])[1] || '';
      (INTERNAL_HOSTS.includes(host.toLowerCase()) ? internal : external).push(url);
      return;
    }
    // Relative, root-relative and storage-relative paths are all our own.
    if (!url.includes(':')) internal.push(url);
  };

  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || typeof block !== 'object') continue;
    const data = block.data && typeof block.data === 'object' ? block.data : {};

    if (typeof data.html === 'string') {
      for (const match of data.html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']*)["']/gi)) {
        classify(match[1]);
      }
    }
    if (block.type === 'cta_button') classify(data.url || data.href);
    if (block.type === 'faq_accordion' && Array.isArray(data.items)) {
      for (const item of data.items) {
        for (const field of [item?.answer_html, item?.question_html]) {
          if (typeof field !== 'string') continue;
          for (const match of field.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']*)["']/gi)) {
            classify(match[1]);
          }
        }
      }
    }
  }

  return { internal, external };
}

/**
 * Scores a full article.
 *
 * @param {object} input
 * @param {string} [input.title] Used only for keyword-in-heading context, not re-scored.
 * @param {Array} input.blocks `content_blocks`.
 * @param {string} [input.keyword] Primary target keyword.
 * @param {string[]} [input.secondaryKeywords]
 * @param {string} [input.metaDescription]
 * @returns {{score: number, breakdown: Array<{criterion: string, points: number, max: number, met: boolean, detail: string}>}}
 */
function scoreArticle({ title, blocks, keyword, secondaryKeywords = [], metaDescription } = {}) {
  const blockList = Array.isArray(blocks) ? blocks : [];
  const bodyText = normalise(blocksToPlainText(blockList));
  const words = countWords(blockList);
  const normalisedKeyword = normalise(keyword);
  const breakdown = [];

  // --- Word count ----------------------------------------------------------
  let wordRatio;
  let wordDetail;
  if (words >= WORD_COUNT.OPTIMAL_MIN && words <= WORD_COUNT.OPTIMAL_MAX) {
    wordRatio = 1;
    wordDetail = `${words} words — inside the ${WORD_COUNT.OPTIMAL_MIN}–${WORD_COUNT.OPTIMAL_MAX} target for an informational article.`;
  } else if (words >= WORD_COUNT.ACCEPTABLE_MIN && words <= WORD_COUNT.ACCEPTABLE_MAX) {
    wordRatio = 0.7;
    wordDetail =
      words < WORD_COUNT.OPTIMAL_MIN
        ? `${words} words — usable but thinner than the pages already ranking. Aim for ${WORD_COUNT.OPTIMAL_MIN}+.`
        : `${words} words — long. Consider splitting into two articles.`;
  } else if (words >= WORD_COUNT.THIN_MIN) {
    wordRatio = 0.4;
    wordDetail = `${words} words — thin for this topic. Aim for at least ${WORD_COUNT.ACCEPTABLE_MIN}.`;
  } else {
    wordRatio = words === 0 ? 0 : 0.1;
    wordDetail = words === 0 ? 'There is no article content yet.' : `${words} words — far too thin to rank.`;
  }
  breakdown.push(row('WORD_COUNT', ARTICLE_WEIGHTS.WORD_COUNT, wordRatio, wordDetail));

  // --- Keyword density ----------------------------------------------------
  // Multi-word phrases are weighted by their length: three occurrences of a
  // three-word phrase occupy nine words of the body, not three, and treating
  // them as three would under-report density on every long-tail keyword.
  const occurrences = countPhrase(bodyText, normalisedKeyword);
  const density = words > 0 && normalisedKeyword !== ''
    ? (occurrences * phraseWordCount(normalisedKeyword)) / words * 100
    : 0;
  const shown = density.toFixed(2);

  let densityRatio;
  let densityDetail;
  if (normalisedKeyword === '') {
    densityRatio = 0;
    densityDetail = 'No target keyword was set, so density cannot be scored.';
  } else if (density >= KEYWORD_DENSITY.OPTIMAL_MIN && density <= KEYWORD_DENSITY.OPTIMAL_MAX) {
    densityRatio = 1;
    densityDetail = `"${keyword}" appears ${occurrences} times (${shown}% density) — inside the ${KEYWORD_DENSITY.OPTIMAL_MIN}–${KEYWORD_DENSITY.OPTIMAL_MAX}% band.`;
  } else if (density > KEYWORD_DENSITY.STUFFING_MAX) {
    // Scored at zero, not partially: above this the repetition is a liability
    // rather than a weak signal, and the score has to say so plainly.
    densityRatio = 0;
    densityDetail = `Keyword stuffing: "${keyword}" appears ${occurrences} times (${shown}% density). Reduce to under ${KEYWORD_DENSITY.OPTIMAL_MAX}%.`;
  } else if (density > KEYWORD_DENSITY.OPTIMAL_MAX) {
    densityRatio = 0.4;
    densityDetail = `"${keyword}" appears ${occurrences} times (${shown}% density) — above the ${KEYWORD_DENSITY.OPTIMAL_MAX}% ceiling and starting to read as stuffed.`;
  } else if (density >= KEYWORD_DENSITY.LOW_MIN) {
    densityRatio = 0.5;
    densityDetail = `"${keyword}" appears ${occurrences} times (${shown}% density) — below the ${KEYWORD_DENSITY.OPTIMAL_MIN}% floor. Work it in a few more times.`;
  } else {
    densityRatio = 0;
    densityDetail = occurrences === 0
      ? `"${keyword}" does not appear in the body text at all.`
      : `"${keyword}" appears only ${occurrences} times (${shown}% density) — too sparse to establish the topic.`;
  }
  breakdown.push(row('KEYWORD_DENSITY', ARTICLE_WEIGHTS.KEYWORD_DENSITY, densityRatio, densityDetail));

  // --- Heading structure --------------------------------------------------
  const headings = blockList.filter((b) => b && b.type === 'heading');
  const h2s = headings.filter((b) => Number(b.data?.level ?? 2) === 2);
  const h3s = headings.filter((b) => Number(b.data?.level) === 3);
  const expected = Math.max(2, Math.ceil(words / WORDS_PER_HEADING));

  // Three sub-checks, equally weighted, so the detail names the actual gap.
  const structureChecks = [
    {
      ok: h2s.length >= 2,
      note: h2s.length >= 2 ? `${h2s.length} h2 sections` : `only ${h2s.length} h2 section(s) — use at least 2`,
    },
    {
      ok: headings.length >= expected,
      note:
        headings.length >= expected
          ? `${headings.length} headings for ${words} words`
          : `${headings.length} headings for ${words} words — around ${expected} would break this up better`,
    },
    {
      // An h3 before any h2 is a real hierarchy error: it implies a subsection
      // with no section, which breaks the document outline for screen readers.
      ok: h3s.length === 0 || headings.findIndex((b) => Number(b.data?.level) === 3) > headings.findIndex((b) => Number(b.data?.level ?? 2) === 2),
      note:
        h3s.length === 0
          ? 'no subsections to mis-nest'
          : 'h3 subsections sit correctly under an h2',
    },
  ];
  const passed = structureChecks.filter((c) => c.ok).length;
  breakdown.push(
    row(
      'HEADING_STRUCTURE',
      ARTICLE_WEIGHTS.HEADING_STRUCTURE,
      passed / structureChecks.length,
      `Heading structure: ${structureChecks.map((c) => c.note).join('; ')}.`
    )
  );

  // --- Secondary keywords -------------------------------------------------
  const secondaries = (Array.isArray(secondaryKeywords) ? secondaryKeywords : [])
    .map(normalise)
    .filter(Boolean);
  if (secondaries.length === 0) {
    // Full marks when none were supplied, marked as met. Scoring zero would make
    // 100 unreachable for any blog that legitimately targets a single term, which
    // would teach authors to add keywords they do not want.
    breakdown.push(
      row(
        'SECONDARY_KEYWORDS',
        ARTICLE_WEIGHTS.SECONDARY_KEYWORDS,
        1,
        'No secondary keywords were set, so there is nothing to cover here.',
        true
      )
    );
  } else {
    const covered = secondaries.filter((k) => countPhrase(bodyText, k) > 0);
    const missing = secondaries.filter((k) => !covered.includes(k));
    breakdown.push(
      row(
        'SECONDARY_KEYWORDS',
        ARTICLE_WEIGHTS.SECONDARY_KEYWORDS,
        covered.length / secondaries.length,
        missing.length === 0
          ? `All ${secondaries.length} secondary keywords appear in the body.`
          : `${covered.length} of ${secondaries.length} secondary keywords covered. Missing: ${missing.map((k) => `"${k}"`).join(', ')}.`
      )
    );
  }

  // --- Links ---------------------------------------------------------------
  const { internal, external } = collectLinks(blockList);
  const linkRatio = (internal.length > 0 ? 0.5 : 0) + (external.length > 0 ? 0.5 : 0);
  breakdown.push(
    row(
      'LINKS',
      ARTICLE_WEIGHTS.LINKS,
      linkRatio,
      `${internal.length} internal link(s), ${external.length} external link(s). ` +
        (internal.length === 0 ? 'Add at least one internal link. ' : '') +
        (external.length === 0 ? 'Add one credible external reference.' : '').trim()
    )
  );

  // --- Image alt text -----------------------------------------------------
  const images = blockList.filter((b) => b && b.type === 'image' && (b.data?.url || b.data?.src));
  if (images.length === 0) {
    // Marked NOT met even though it scores full: there is nothing wrong with the
    // article, but "you have no images" is worth surfacing in the panel.
    breakdown.push(
      row(
        'IMAGE_ALT',
        ARTICLE_WEIGHTS.IMAGE_ALT,
        1,
        'No images in the article, so there is no alt text to check. Adding one image usually helps engagement.',
        false
      )
    );
  } else {
    const described = images.filter((b) => String(b.data?.alt_text || b.data?.alt || '').trim() !== '');
    breakdown.push(
      row(
        'IMAGE_ALT',
        ARTICLE_WEIGHTS.IMAGE_ALT,
        described.length / images.length,
        `${described.length} of ${images.length} image(s) have alt text.` +
          (described.length === images.length ? '' : ' Alt text is an accessibility requirement, not an option.')
      )
    );
  }

  // --- Meta description ---------------------------------------------------
  const meta = toPlainText(typeof metaDescription === 'string' ? metaDescription : '').trim();
  const metaLength = meta.length;
  let metaRatio;
  let metaDetail;
  if (metaLength >= META_DESCRIPTION_LENGTH.MIN && metaLength <= META_DESCRIPTION_LENGTH.MAX) {
    metaRatio = 1;
    metaDetail = `${metaLength} characters — inside the ${META_DESCRIPTION_LENGTH.MIN}–${META_DESCRIPTION_LENGTH.MAX} band.`;
  } else if (
    metaLength >= META_DESCRIPTION_LENGTH.ACCEPTABLE_MIN &&
    metaLength <= META_DESCRIPTION_LENGTH.ACCEPTABLE_MAX
  ) {
    metaRatio = 0.7;
    metaDetail = `${metaLength} characters — close. Aim for ${META_DESCRIPTION_LENGTH.MIN}–${META_DESCRIPTION_LENGTH.MAX}.`;
  } else if (metaLength >= META_DESCRIPTION_LENGTH.THIN_MIN) {
    metaRatio = 0.4;
    metaDetail = `${metaLength} characters — well outside the ${META_DESCRIPTION_LENGTH.MIN}–${META_DESCRIPTION_LENGTH.MAX} band.`;
  } else {
    metaRatio = 0;
    metaDetail = metaLength === 0
      ? 'No meta description. This is the copy that decides whether the result gets clicked.'
      : `${metaLength} characters — far too short to describe the page.`;
  }
  breakdown.push(row('META_DESCRIPTION', ARTICLE_WEIGHTS.META_DESCRIPTION, metaRatio, metaDetail));

  // --- FAQ -----------------------------------------------------------------
  const faqBlocks = blockList.filter((b) => b && b.type === 'faq_accordion');
  const faqItems = faqBlocks.reduce(
    (sum, b) => sum + (Array.isArray(b.data?.items) ? b.data.items.filter((i) => i && i.question).length : 0),
    0
  );
  breakdown.push(
    row(
      'FAQ',
      ARTICLE_WEIGHTS.FAQ,
      faqItems >= 3 ? 1 : faqItems >= 1 ? 0.5 : 0,
      faqItems === 0
        ? 'No FAQ section. An FAQ earns FAQPage structured data and can win a People-Also-Ask slot.'
        : `FAQ with ${faqItems} question(s).${faqItems < 3 ? ' Three or more is the useful threshold.' : ''}`
    )
  );

  // `title` is accepted for interface symmetry with scoreTitle and for future
  // criteria (keyword-in-h1); it is intentionally not double-counted here,
  // because the title has its own score and adding it twice would let a good
  // title mask a thin article.
  void title;

  return { score: totalOf(breakdown), breakdown };
}

module.exports = {
  scoreTitle,
  scoreArticle,
  TITLE_WEIGHTS,
  ARTICLE_WEIGHTS,
  TITLE_LENGTH,
  WORD_COUNT,
  KEYWORD_DENSITY,
  META_DESCRIPTION_LENGTH,
  WORDS_PER_HEADING,
  POWER_WORDS,
  INTERNAL_HOSTS,
  countPhrase,
  collectLinks,
};
