'use strict';

/**
 * Answer Engine Optimization (AEO) scoring.
 *
 * ---------------------------------------------------------------------------
 * WHAT AEO MEANS HERE
 * ---------------------------------------------------------------------------
 * AEO is about winning the surface *above* the traditional blue links: Google's
 * AI Overviews, featured snippets, and "People Also Ask" boxes. That surface
 * rewards a different shape of content than classic SEO — a direct, extractable
 * answer near the top, question-shaped headings, structured Q&A/list/table
 * blocks, and E-E-A-T signals (byline, freshness). None of that is about
 * keyword density; it is about "can an extraction algorithm lift a self-
 * contained answer out of this paragraph".
 *
 * Same design rules as seoScore.js on purpose (see that file's header for the
 * full rationale):
 *   1. Pure heuristic, no AI call — deterministic and explainable.
 *   2. Every criterion returns its own points/max/met/detail row.
 *   3. Every weight is a named constant carrying its own justification.
 *
 * Weights sum to exactly 100, asserted by a unit test mirroring seoScore's.
 */

const { blocksToPlainText } = require('./blocksToHtml');

// ===========================================================================
// WEIGHTS — total 100
// ===========================================================================

/**
 * DIRECT_ANSWER (20) — the single highest weight. Featured snippets and AI
 *   Overviews are, mechanically, an extraction of one self-contained answer.
 *   An article that never states its answer plainly near a heading is
 *   invisible to that extraction step regardless of how good the rest of the
 *   content is.
 *
 * QUESTION_HEADINGS (15) — Query fan-out (the mechanism behind AI Overviews)
 *   matches natural-language questions against heading text. "What is Mangal
 *   Dosha?" is matchable; "Understanding Mangal Dosha" is not.
 *
 * FAQ_STRUCTURE (15) — FAQ blocks are the most direct route into a
 *   People-Also-Ask slot and can carry FAQPage structured data. Equal to
 *   question headings because both are load-bearing routes into the same
 *   surface, from different angles.
 *
 * STRUCTURED_DATA (15) — lists, tables and key-takeaway boxes are exactly the
 *   shapes extraction engines lift cleanly; a wall of prose is not.
 *
 * EEAT_BYLINE (10) — a named, credentialed author is a core Google selection
 *   signal for AI Overviews. Lower weight than the structural criteria above
 *   because it is a single binary fact, not a spectrum of quality.
 *
 * FRESHNESS (10) — content updated within the last 30 days is cited
 *   meaningfully more often. Equal to byline for the same reason: one dated
 *   fact, not a graded quality.
 *
 * MULTI_MODAL (10) — pages combining text with images/video show markedly
 *   higher AI Overview selection. Astrology content already leans on imagery,
 *   so this should rarely be the failing criterion.
 *
 * META_DESCRIPTION_ANSWER (5) — the lowest weight. A meta description that is
 *   itself a complete answer sentence (not a teaser) sometimes doubles as the
 *   snippet text, but it is a small and situational win next to the criteria
 *   above.
 */
const AEO_WEIGHTS = Object.freeze({
  DIRECT_ANSWER: 20,
  QUESTION_HEADINGS: 15,
  FAQ_STRUCTURE: 15,
  STRUCTURED_DATA: 15,
  EEAT_BYLINE: 10,
  FRESHNESS: 10,
  MULTI_MODAL: 10,
  META_DESCRIPTION_ANSWER: 5,
});

// ===========================================================================
// Bands and vocabularies
// ===========================================================================

/** A "direct answer" paragraph should be this many words — long enough to be
 *  complete, short enough to be lifted whole into a snippet. */
const ANSWER_CAPSULE = Object.freeze({ MIN: 30, MAX: 80 });

/** Content is "fresh" inside this window; AI engines cite it materially more. */
const FRESHNESS_DAYS = 30;

/** English question words used to detect a heading phrased as a question. */
const QUESTION_STARTERS = Object.freeze([
  'what', 'why', 'how', 'when', 'where', 'who', 'which', 'is', 'are', 'can',
  'does', 'do', 'should', 'will',
]);

/** Attribution values that do not count as a real named author for E-E-A-T. */
const GENERIC_BYLINES = Object.freeze([
  '', 'divinetalk astrology', 'divinetalk', 'admin', 'staff', 'editor',
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

function normalise(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(text) {
  const trimmed = String(text ?? '').trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).filter(Boolean).length;
}

/** True when a heading's text reads as a natural-language question. */
function isQuestionHeading(text) {
  const t = normalise(text).replace(/[?]+$/, '');
  if (t === '') return false;
  const firstWord = t.split(' ')[0];
  return String(text).trim().endsWith('?') || QUESTION_STARTERS.includes(firstWord);
}

/** Extracts heading blocks with their text and the paragraph immediately following. */
function extractHeadingsWithFollowers(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  const results = [];
  for (let i = 0; i < list.length; i += 1) {
    const block = list[i];
    if (!block || block.type !== 'heading') continue;
    const text = block.data?.text || '';
    let follower = '';
    for (let j = i + 1; j < list.length; j += 1) {
      const next = list[j];
      if (!next) continue;
      if (next.type === 'heading') break;
      if (next.type === 'paragraph') {
        follower = next.data?.text || next.data?.html || '';
        break;
      }
    }
    results.push({ text, follower });
  }
  return results;
}

// ===========================================================================
// Main scoring function
// ===========================================================================

/**
 * Scores an article's Answer Engine Optimization readiness.
 *
 * @param {object} options
 * @param {Array} options.blocks - content_blocks array.
 * @param {string} [options.metaDescription]
 * @param {string} [options.publishedBy] - Attribution string (byline).
 * @param {Date|string|null} [options.updatedAt] - Last meaningful content update.
 * @returns {{score: number|null, breakdown: Array}}
 */
function scoreArticle({ blocks, metaDescription, publishedBy, updatedAt } = {}) {
  const blockList = Array.isArray(blocks) ? blocks.filter(Boolean) : [];
  if (blockList.length === 0) {
    return { score: null, breakdown: [] };
  }

  const breakdown = [];
  const bodyText = blocksToPlainText(blockList);

  // --- Direct answer capsule ----------------------------------------------
  // Look at the first paragraph in the article and at the paragraph following
  // each heading; a "hit" is any of them landing in the answer-capsule band.
  const headingsWithFollowers = extractHeadingsWithFollowers(blockList);
  const firstParagraph = blockList.find((b) => b && b.type === 'paragraph');
  const candidates = [
    firstParagraph?.data?.text || firstParagraph?.data?.html || '',
    ...headingsWithFollowers.map((h) => h.follower),
  ].filter(Boolean);

  const capsuleHits = candidates.filter((text) => {
    const wc = wordCount(text);
    return wc >= ANSWER_CAPSULE.MIN && wc <= ANSWER_CAPSULE.MAX;
  });

  if (candidates.length === 0) {
    breakdown.push(
      row(
        'DIRECT_ANSWER',
        AEO_WEIGHTS.DIRECT_ANSWER,
        0,
        'No paragraph follows the opening or any heading, so there is no extractable answer capsule.'
      )
    );
  } else {
    const ratio = capsuleHits.length / candidates.length;
    breakdown.push(
      row(
        'DIRECT_ANSWER',
        AEO_WEIGHTS.DIRECT_ANSWER,
        ratio,
        capsuleHits.length === 0
          ? `None of the ${candidates.length} answer paragraph(s) are ${ANSWER_CAPSULE.MIN}-${ANSWER_CAPSULE.MAX} words. Snippet extraction favours a short, complete answer.`
          : `${capsuleHits.length} of ${candidates.length} answer paragraph(s) are in the ${ANSWER_CAPSULE.MIN}-${ANSWER_CAPSULE.MAX} word snippet-ready band.`
      )
    );
  }

  // --- Question-format headings --------------------------------------------
  const headings = headingsWithFollowers.filter((h) => h.text);
  if (headings.length === 0) {
    breakdown.push(
      row(
        'QUESTION_HEADINGS',
        AEO_WEIGHTS.QUESTION_HEADINGS,
        0,
        'No headings in the article. AI Overviews match question-shaped headings against user queries.'
      )
    );
  } else {
    const questionCount = headings.filter((h) => isQuestionHeading(h.text)).length;
    const ratio = questionCount / headings.length;
    breakdown.push(
      row(
        'QUESTION_HEADINGS',
        AEO_WEIGHTS.QUESTION_HEADINGS,
        ratio,
        `${questionCount} of ${headings.length} heading(s) are phrased as questions (e.g. "What is...", "How to..."). ${
          questionCount === 0 ? 'Rephrase at least a few headings as natural questions.' : ''
        }`.trim()
      )
    );
  }

  // --- FAQ structure --------------------------------------------------------
  const faqBlocks = blockList.filter((b) => b.type === 'faq_accordion');
  const faqItems = faqBlocks.reduce(
    (sum, b) => sum + (Array.isArray(b.data?.items) ? b.data.items.filter((i) => i && i.question).length : 0),
    0
  );
  breakdown.push(
    row(
      'FAQ_STRUCTURE',
      AEO_WEIGHTS.FAQ_STRUCTURE,
      faqItems >= 3 ? 1 : faqItems >= 1 ? 0.5 : 0,
      faqItems === 0
        ? 'No FAQ block. A 3+ question FAQ is the most direct route into a People-Also-Ask slot.'
        : `FAQ with ${faqItems} question(s).${faqItems < 3 ? ' Three or more is the useful threshold.' : ' Meets the People-Also-Ask threshold.'}`
    )
  );

  // --- Structured data (lists, tables, key takeaways) -----------------------
  const structuredTypes = ['list', 'table', 'key_takeaway'];
  const structuredCount = blockList.filter((b) => structuredTypes.includes(b.type)).length;
  breakdown.push(
    row(
      'STRUCTURED_DATA',
      AEO_WEIGHTS.STRUCTURED_DATA,
      structuredCount >= 2 ? 1 : structuredCount === 1 ? 0.6 : 0,
      structuredCount === 0
        ? 'No list, table, or key-takeaway blocks. These are the shapes extraction engines lift cleanly from a page.'
        : `${structuredCount} structured block(s) (list/table/key-takeaway) present.`
    )
  );

  // --- E-E-A-T: named byline --------------------------------------------------
  const byline = normalise(publishedBy);
  const hasRealByline = byline !== '' && !GENERIC_BYLINES.includes(byline);
  breakdown.push(
    row(
      'EEAT_BYLINE',
      AEO_WEIGHTS.EEAT_BYLINE,
      hasRealByline ? 1 : 0,
      hasRealByline
        ? `Attributed to "${publishedBy}" — a named author signal.`
        : 'No named author byline. A generic or missing attribution weakens E-E-A-T signals AI Overviews weigh in source selection.'
    )
  );

  // --- Freshness --------------------------------------------------------------
  let freshnessRatio = 0;
  let freshnessDetail = 'No update timestamp available.';
  if (updatedAt) {
    const updated = new Date(updatedAt);
    if (!Number.isNaN(updated.getTime())) {
      const ageDays = Math.floor((Date.now() - updated.getTime()) / (1000 * 60 * 60 * 24));
      if (ageDays <= FRESHNESS_DAYS) {
        freshnessRatio = 1;
        freshnessDetail = `Updated ${ageDays} day(s) ago — inside the ${FRESHNESS_DAYS}-day freshness window that correlates with materially higher AI citation rates.`;
      } else {
        freshnessRatio = Math.max(0, 1 - (ageDays - FRESHNESS_DAYS) / 180);
        freshnessDetail = `Updated ${ageDays} day(s) ago — outside the ${FRESHNESS_DAYS}-day freshness window. Consider a content refresh.`;
      }
    }
  }
  breakdown.push(row('FRESHNESS', AEO_WEIGHTS.FRESHNESS, freshnessRatio, freshnessDetail));

  // --- Multi-modal (images present) -------------------------------------------
  const imageCount = blockList.filter((b) => b.type === 'image').length;
  breakdown.push(
    row(
      'MULTI_MODAL',
      AEO_WEIGHTS.MULTI_MODAL,
      imageCount >= 1 ? 1 : 0,
      imageCount === 0
        ? 'No images. Pages combining text with visuals show materially higher AI Overview selection rates.'
        : `${imageCount} image(s) present.`
    )
  );

  // --- Meta description as a complete answer ----------------------------------
  const meta = String(metaDescription ?? '').trim();
  const metaWords = wordCount(meta);
  const looksLikeAnswer = meta !== '' && !meta.endsWith('...') && metaWords >= 12;
  breakdown.push(
    row(
      'META_DESCRIPTION_ANSWER',
      AEO_WEIGHTS.META_DESCRIPTION_ANSWER,
      looksLikeAnswer ? 1 : meta !== '' ? 0.4 : 0,
      meta === ''
        ? 'No meta description.'
        : looksLikeAnswer
          ? 'Meta description reads as a complete answer sentence, not a teaser — it can double as snippet text.'
          : 'Meta description present but reads as a teaser (short or trails off with "..."). A complete answer sentence sometimes doubles as the snippet.'
    )
  );

  void bodyText; // reserved for future entity-density criteria

  return { score: totalOf(breakdown), breakdown };
}

module.exports = {
  scoreArticle,
  AEO_WEIGHTS,
  ANSWER_CAPSULE,
  FRESHNESS_DAYS,
  QUESTION_STARTERS,
  isQuestionHeading,
};
