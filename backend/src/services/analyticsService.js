'use strict';

/**
 * Dashboard aggregates.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS AGGREGATES IN JAVASCRIPT RATHER THAN IN SQL
 * ---------------------------------------------------------------------------
 * Grouping by month needs `DATE_FORMAT` on MySQL and `strftime` on SQLite, and
 * bucketing a score needs a CASE expression whose syntax differs again. Writing
 * that twice, or writing raw SQL per dialect, would mean the test suite (SQLite)
 * exercises different code than production (MySQL) — which is exactly the class
 * of bug a portable test suite is supposed to prevent.
 *
 * So the queries stay simple and portable, and the shaping happens in JS. The
 * cost is real but bounded: this is an internal tool whose table holds low
 * thousands of rows, and each query below selects only the handful of narrow
 * columns it needs — never `blog_content`, which is the only large column.
 *
 * The point to revisit this: if `blogs` passes ~100k rows, or the dashboard is
 * hit often enough for the full-table scan to matter, push these into
 * dialect-specific SQL or a materialised summary table. Noted in ARCHITECTURE.md.
 */

const { Op } = require('sequelize');
const config = require('../config');
const { Blog } = require('../models');
const {
  BLOG_STATUS,
  BLOG_STATUS_LABELS,
  GENERATION_STATUS,
} = require('../constants');

/** SEO score buckets for the distribution chart. */
const SCORE_BUCKETS = Object.freeze([
  { label: '0–20', min: 0, max: 20 },
  { label: '21–40', min: 21, max: 40 },
  { label: '41–60', min: 41, max: 60 },
  { label: '61–80', min: 61, max: 80 },
  { label: '81–100', min: 81, max: 100 },
]);

/** 'YYYY-MM' key for a date-ish value, or null when unusable. */
function monthKey(value) {
  if (!value) return null;
  // DATEONLY columns come back as 'YYYY-MM-DD' strings; DATE columns as Date.
  const iso = typeof value === 'string' ? value : value.toISOString();
  return iso.slice(0, 7);
}

/** Rounds to one decimal place, returning null for an empty set. */
function average(values) {
  const usable = values.filter((v) => Number.isFinite(v));
  if (usable.length === 0) return null;
  return Math.round((usable.reduce((sum, v) => sum + v, 0) / usable.length) * 10) / 10;
}

/**
 * Produces an unbroken list of 'YYYY-MM' keys ending at the current month.
 *
 * Charts need the gaps: a month with no posts must render as zero, not be
 * omitted, or the x-axis silently compresses and the trend line lies.
 */
function monthSeries(months) {
  const keys = [];
  const cursor = new Date();
  cursor.setUTCDate(1);
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(cursor);
    d.setUTCMonth(d.getUTCMonth() - i);
    keys.push(d.toISOString().slice(0, 7));
  }
  return keys;
}

/**
 * Builds the full dashboard payload.
 *
 * @param {object} [options]
 * @param {number} [options.months=7] Window for the time-series charts.
 * @returns {Promise<object>}
 */
async function getOverview({ months = 7 } = {}) {
  // One pass over the narrow columns the dashboard needs. Deliberately excludes
  // blog_content and content_blocks, which are the expensive ones.
  const rows = await Blog.findAll({
    attributes: [
      'id',
      'blog_title',
      'slug',
      'blog_status',
      'generation_status',
      'seo_score',
      'aeo_score',
      'geo_score',
      'word_count',
      'total_views',
      'publish_date',
      'created_at',
      'updated_at',
      'category',
      'seo_keywords',
      'topic',
      'secondary_keywords',
      'serp_rank_keyword',
      'serp_rank_position',
      'serp_rank_checked_at',
    ],
    order: [['created_at', 'DESC']],
  });

  // --- Totals ---------------------------------------------------------------
  const statusCounts = Object.values(BLOG_STATUS).reduce((acc, value) => {
    acc[value] = 0;
    return acc;
  }, {});
  const generationCounts = Object.values(GENERATION_STATUS).reduce((acc, value) => {
    acc[value] = 0;
    return acc;
  }, {});

  for (const row of rows) {
    if (statusCounts[row.blog_status] !== undefined) statusCounts[row.blog_status] += 1;
    if (row.generation_status && generationCounts[row.generation_status] !== undefined) {
      generationCounts[row.generation_status] += 1;
    }
  }

  const totals = {
    total: rows.length,
    draft: statusCounts[BLOG_STATUS.DRAFT],
    published: statusCounts[BLOG_STATUS.PUBLISHED],
    scheduled: statusCounts[BLOG_STATUS.SCHEDULED],
    archived: statusCounts[BLOG_STATUS.ARCHIVED],
    total_views: rows.reduce((sum, r) => sum + (r.total_views || 0), 0),
    // Averaged over scored articles only — counting unscored drafts as zero
    // would drag the number down and misrepresent published quality. Same
    // convention for aeo/geo: both are null until an article has content (see
    // the beforeSave hook in models/blog.js), so they are excluded from the
    // average by average()'s Number.isFinite filter exactly like seo_score.
    avg_seo_score: average(rows.map((r) => r.seo_score)),
    avg_aeo_score: average(rows.map((r) => r.aeo_score)),
    avg_geo_score: average(rows.map((r) => r.geo_score)),
    avg_word_count: average(rows.map((r) => r.word_count)),
    generation: generationCounts,
    in_flight: generationCounts[GENERATION_STATUS.QUEUED] + generationCounts[GENERATION_STATUS.GENERATING],
  };

  // --- Status breakdown (donut) --------------------------------------------
  const status_breakdown = Object.values(BLOG_STATUS).map((value) => ({
    status: value,
    label: BLOG_STATUS_LABELS[value],
    count: statusCounts[value],
  }));

  // --- Published over time + word-count trend ------------------------------
  const series = monthSeries(months);
  const byMonth = new Map(
    series.map((key) => [key, { published: 0, wordCounts: [], scores: [], aeoScores: [], geoScores: [] }])
  );

  for (const row of rows) {
    // Grouped on publish_date, which is what "published over time" means. Rows
    // without one (drafts) are correctly absent from this chart.
    const key = monthKey(row.publish_date);
    if (!key || !byMonth.has(key)) continue;
    const bucket = byMonth.get(key);
    if (row.blog_status === BLOG_STATUS.PUBLISHED || row.blog_status === BLOG_STATUS.ARCHIVED) {
      bucket.published += 1;
    }
    if (Number.isFinite(row.word_count)) bucket.wordCounts.push(row.word_count);
    if (Number.isFinite(row.seo_score)) bucket.scores.push(row.seo_score);
    if (Number.isFinite(row.aeo_score)) bucket.aeoScores.push(row.aeo_score);
    if (Number.isFinite(row.geo_score)) bucket.geoScores.push(row.geo_score);
  }

  const published_over_time = series.map((key) => ({
    month: key,
    count: byMonth.get(key).published,
  }));

  const word_count_trend = series.map((key) => ({
    month: key,
    avg_word_count: average(byMonth.get(key).wordCounts),
    articles: byMonth.get(key).wordCounts.length,
  }));

  const seo_score_trend = series.map((key) => ({
    month: key,
    avg_seo_score: average(byMonth.get(key).scores),
  }));

  // Same gap-filled monthly shape as seo_score_trend, kept as separate series
  // (rather than folded into one multi-line payload) so a frontend chart that
  // only wants SEO does not have to know AEO/GEO exist.
  const aeo_score_trend = series.map((key) => ({
    month: key,
    avg_aeo_score: average(byMonth.get(key).aeoScores),
  }));

  const geo_score_trend = series.map((key) => ({
    month: key,
    avg_geo_score: average(byMonth.get(key).geoScores),
  }));

  // --- Score distributions (SEO / AEO / GEO) --------------------------------
  // Same 5-bucket shape for all three, built by the same bucket definition —
  // a distribution histogram means the same thing regardless of which score it
  // is counting, so one function applied three times rather than three
  // hand-written blocks keeps the buckets from drifting out of sync.
  function distributionFor(scoreKey) {
    return SCORE_BUCKETS.map((bucket) => ({
      label: bucket.label,
      range: [bucket.min, bucket.max],
      count: rows.filter(
        (r) => Number.isFinite(r[scoreKey]) && r[scoreKey] >= bucket.min && r[scoreKey] <= bucket.max
      ).length,
    }));
  }

  const seo_score_distribution = distributionFor('seo_score');
  const aeo_score_distribution = distributionFor('aeo_score');
  const geo_score_distribution = distributionFor('geo_score');

  // --- Top keywords ---------------------------------------------------------
  // Counts the primary keyword and the secondary list together, since both are
  // things the team actually targets. Normalised to lowercase so 'Shravan Month'
  // and 'shravan month' do not split the count.
  const keywordStats = new Map();
  function noteKeyword(keyword, row) {
    if (typeof keyword !== 'string') return;
    const normalised = keyword.trim().toLowerCase();
    if (normalised === '') return;
    if (!keywordStats.has(normalised)) {
      keywordStats.set(normalised, { keyword: normalised, count: 0, scores: [], views: 0 });
    }
    const entry = keywordStats.get(normalised);
    entry.count += 1;
    if (Number.isFinite(row.seo_score)) entry.scores.push(row.seo_score);
    entry.views += row.total_views || 0;
  }

  for (const row of rows) {
    noteKeyword(row.seo_keywords, row);
    for (const secondary of row.secondary_keywords || []) noteKeyword(secondary, row);
  }

  const top_keywords = [...keywordStats.values()]
    .map((entry) => ({
      keyword: entry.keyword,
      count: entry.count,
      avg_seo_score: average(entry.scores),
      total_views: entry.views,
    }))
    .sort((a, b) => b.count - a.count || b.total_views - a.total_views)
    .slice(0, 12);

  // --- Categories -----------------------------------------------------------
  const categoryCounts = new Map();
  for (const row of rows) {
    const key = row.category || 'Uncategorised';
    categoryCounts.set(key, (categoryCounts.get(key) || 0) + 1);
  }
  const category_breakdown = [...categoryCounts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  // --- Recent activity ------------------------------------------------------
  const recent = rows.slice(0, 8).map((row) => ({
    id: Number(row.id),
    blog_title: row.blog_title,
    slug: row.slug,
    blog_status: row.blog_status,
    blog_status_label: BLOG_STATUS_LABELS[row.blog_status],
    generation_status: row.generation_status,
    seo_score: row.seo_score,
    aeo_score: row.aeo_score,
    geo_score: row.geo_score,
    word_count: row.word_count,
    updated_at: row.updated_at,
  }));

  const payload = {
    totals,
    status_breakdown,
    published_over_time,
    word_count_trend,
    seo_score_trend,
    aeo_score_trend,
    geo_score_trend,
    seo_score_distribution,
    aeo_score_distribution,
    geo_score_distribution,
    top_keywords,
    category_breakdown,
    recent,
    meta: {
      months,
      // Tells the frontend whether to render the SERP chart at all, instead of
      // showing an empty panel for a feature that is switched off.
      serp_enabled: config.serp.enabled,
      generated_at: new Date().toISOString(),
    },
  };

  // --- SERP rank trend (feature-flagged) -----------------------------------
  // Only present when SerpAPI is configured. Section 6 of the spec makes this
  // chart conditional on SERPAPI_ENABLED.
  if (config.serp.enabled) {
    payload.serp_rank = rows
      .filter((row) => row.serp_rank_keyword && Number.isFinite(row.serp_rank_position))
      .map((row) => ({
        blog_id: Number(row.id),
        blog_title: row.blog_title,
        keyword: row.serp_rank_keyword,
        position: row.serp_rank_position,
        checked_at: row.serp_rank_checked_at,
      }))
      .sort((a, b) => a.position - b.position);
  }

  return payload;
}

/**
 * Blogs whose generation is currently queued or running.
 *
 * The dashboard polls this to show live progress without pulling the whole list.
 */
async function getInFlightGenerations() {
  const rows = await Blog.findAll({
    where: {
      generation_status: { [Op.in]: [GENERATION_STATUS.QUEUED, GENERATION_STATUS.GENERATING] },
    },
    attributes: ['id', 'blog_title', 'slug', 'generation_status', 'updated_at'],
    order: [['updated_at', 'ASC']],
    limit: 50,
  });

  return rows.map((row) => ({
    id: Number(row.id),
    blog_title: row.blog_title,
    slug: row.slug,
    generation_status: row.generation_status,
    started_at: row.updated_at,
  }));
}

module.exports = { getOverview, getInFlightGenerations, SCORE_BUCKETS, monthSeries, average };
