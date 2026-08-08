'use strict';

/**
 * Keyword cannibalisation checker (Section 17.2 of the roadmap).
 *
 * Cannibalisation is two of your own articles competing for the same query —
 * the single most common silent SEO defect at scale, because nothing breaks:
 * both pages simply rank worse than one consolidated page would, and there is
 * no error to notice. The fix is structural (one primary keyword per URL,
 * Neil Patel/Semrush/Moz's shared recommendation), but Scriptura's data model
 * does not enforce it at the database level — `seo_keywords` is a free-text
 * column, not a unique key, and it should stay that way (two articles can
 * legitimately share a broad topic while targeting different intents).
 *
 * So this is advisory, not a gate — approved by the team as "warning only":
 * given a candidate primary keyword, find already-published blogs whose own
 * keyword sets overlap it significantly, and let the caller decide (surfaced
 * as an amber notice in the wizard, never a hard block).
 *
 * ---------------------------------------------------------------------------
 * WHY TOKEN OVERLAP, NOT A SERP-OVERLAP CHECK
 * ---------------------------------------------------------------------------
 * The gold-standard technique (Semrush et al.) clusters by *actual* SERP
 * overlap — two keywords belong on one page if Google already ranks the same
 * top-10 URLs for both. That needs a live search API call per comparison,
 * which is exactly the kind of per-keystroke network dependency the wizard's
 * live-scoring UI cannot afford (see seoScore.js's "no AI, no network" rule,
 * which applies here for the same reason). A normalised-token Jaccard overlap
 * over `seo_keywords` + `secondary_keywords` is the cheap, deterministic proxy:
 * it does not know what Google actually ranks, but "these two keyword sets
 * share most of their words" is a solid, explainable heuristic for "these are
 * probably the same query" and costs one indexed DB query, not a network call.
 */

const { BLOG_STATUS } = require('../constants');

/** Overlap at or above this ratio is surfaced as a warning. */
const CANNIBALIZATION_THRESHOLD = 0.6;

/** Common English/astrology-editorial stopwords that would otherwise dominate overlap scoring. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'is',
  'are', 'what', 'how', 'why', 'your', 'you', 'best', 'guide',
]);

/** Splits a keyword string into normalised, stopword-free tokens. */
function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Builds the token set for a blog's full keyword surface (primary + secondary). */
function keywordTokenSet(blog) {
  const secondary = Array.isArray(blog.secondary_keywords) ? blog.secondary_keywords : [];
  const tokens = [
    ...tokenize(blog.seo_keywords),
    ...tokenize(blog.topic),
    ...secondary.flatMap(tokenize),
  ];
  return new Set(tokens);
}

/** Jaccard similarity between two token sets: |intersection| / |union|. */
function jaccard(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Checks whether a candidate primary keyword (+ optional secondary keywords)
 * cannibalises an already-published article's keyword targeting.
 *
 * @param {object} input
 * @param {string} input.keyword - Candidate primary keyword / topic.
 * @param {string[]} [input.secondaryKeywords] - Candidate secondary keywords.
 * @param {number} [input.excludeBlogId] - Exclude this blog id (editing an existing draft).
 * @returns {Promise<{
 *   hasConflict: boolean,
 *   matches: Array<{blog_id: number, blog_title: string, slug: string|null, overlap: number, seo_keywords: string|null}>
 * }>}
 */
async function checkCannibalization({ keyword, secondaryKeywords = [], excludeBlogId = null } = {}) {
  const candidateTokens = new Set([...tokenize(keyword), ...secondaryKeywords.flatMap(tokenize)]);
  if (candidateTokens.size === 0) {
    return { hasConflict: false, matches: [] };
  }

  const { Op } = require('sequelize');
  const { Blog } = require('../models');

  const where = { blog_status: BLOG_STATUS.PUBLISHED };
  if (excludeBlogId) where.id = { [Op.ne]: excludeBlogId };

  // Narrow column selection, consistent with analyticsService's rule of never
  // pulling blog_content/content_blocks for a comparison that only needs the
  // keyword surface.
  const published = await Blog.findAll({
    where,
    attributes: ['id', 'blog_title', 'slug', 'topic', 'seo_keywords', 'secondary_keywords'],
  });

  const matches = [];
  for (const blog of published) {
    const overlap = jaccard(candidateTokens, keywordTokenSet(blog));
    if (overlap >= CANNIBALIZATION_THRESHOLD) {
      matches.push({
        blog_id: Number(blog.id),
        blog_title: blog.blog_title,
        slug: blog.slug || null,
        overlap: Math.round(overlap * 100) / 100,
        seo_keywords: blog.seo_keywords || null,
      });
    }
  }

  matches.sort((a, b) => b.overlap - a.overlap);

  return { hasConflict: matches.length > 0, matches };
}

module.exports = {
  checkCannibalization,
  jaccard,
  tokenize,
  CANNIBALIZATION_THRESHOLD,
};
