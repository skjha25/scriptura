'use strict';

/**
 * Cluster business logic — extracted from clusters.controller.js so the
 * Cluster Agent's proposals/apply dispatcher and the human-facing REST
 * controller call the exact same functions, the same relationship
 * blogService.js already has to blogs.controller.js. There is exactly one
 * write path per table regardless of who (a human clicking the UI, or an
 * agent's apply step) triggers it.
 *
 * This is a mechanical extraction with two intentional bug fixes bundled in
 * (not incidental — call these out in review):
 *
 *   1. `updateKeyword` gains a unique-date pre-check `scheduleAll` already
 *      had but `updateKeyword` never did — editing a single keyword's date
 *      to a slot another keyword already occupies used to hit the DB's
 *      unique constraint directly and surface as a raw uncaught 500.
 *   2. Both `updateKeyword` and `scheduleAll` now catch the underlying
 *      `SequelizeUniqueConstraintError` (a genuine, pre-existing TOCTOU race
 *      on `cluster_keywords.scheduled_generation_date`, which is a GLOBAL
 *      unique index, not scoped per cluster) and convert it to a clean
 *      `ApiError.conflict`, instead of letting it surface as a raw 500.
 *      This does not eliminate the race — it only turns an ugly failure into
 *      a clean, actionable one.
 */

const { Op } = require('sequelize');
const ApiError = require('../utils/ApiError');
const { getTextProvider } = require('./ai');
const { CLUSTER_KEYWORD_STATUS, CLUSTER_STATUS } = require('../constants');

const EXPAND_SEARCH_INTENTS = ['informational', 'commercial', 'transactional', 'navigational'];

/** True when `err` is the DB rejecting a duplicate `scheduled_generation_date`. */
function isUniqueDateConflict(err) {
  return err?.name === 'SequelizeUniqueConstraintError';
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** @param {{page?: number, limit?: number, status?: string, q?: string}} query */
async function listClusters({ page = 1, limit = 20, status, q } = {}) {
  const { KeywordCluster } = require('../models');
  const offset = (Math.max(1, page) - 1) * limit;
  const where = {};

  if (status) where.status = status;
  if (q) {
    const stripped = q.replace(/[\\%_]/g, '').trim();
    if (stripped) {
      where[Op.or] = [
        { name: { [Op.like]: `%${stripped}%` } },
        { head_keyword: { [Op.like]: `%${stripped}%` } },
      ];
    }
  }

  const { count, rows } = await KeywordCluster.findAndCountAll({
    where,
    order: [['created_at', 'DESC']],
    limit,
    offset,
    include: [{ association: 'keywords', attributes: ['id', 'status'] }],
  });

  const data = rows.map((cluster) => {
    const keywords = cluster.keywords || [];
    return {
      ...cluster.toJSON(),
      keyword_count: keywords.length,
      published_count: keywords.filter((k) => k.status === CLUSTER_KEYWORD_STATUS.PUBLISHED).length,
    };
  });

  return { data, pagination: { total: count, page, limit, pages: Math.ceil(count / limit) } };
}

async function getClusterDetail(id) {
  const { KeywordCluster } = require('../models');
  const cluster = await KeywordCluster.findByPk(id, {
    include: [
      {
        association: 'keywords',
        include: [{ association: 'assignedBlog', attributes: ['id', 'blog_title', 'slug', 'blog_status'] }],
      },
      { association: 'pillarBlog', attributes: ['id', 'blog_title', 'slug', 'blog_status'] },
      { association: 'blogs', attributes: ['id', 'blog_title', 'slug', 'blog_status', 'seo_score', 'aeo_score', 'geo_score'] },
    ],
  });

  if (!cluster) throw ApiError.notFound('Cluster not found.');
  return cluster;
}

async function createCluster({ keywords: initialKeywords, ...clusterData }) {
  const { KeywordCluster, ClusterKeyword } = require('../models');
  const cluster = await KeywordCluster.create(clusterData);

  if (Array.isArray(initialKeywords) && initialKeywords.length > 0) {
    const keywordRows = initialKeywords.map((kw, index) => ({
      cluster_id: cluster.id,
      keyword: kw.keyword,
      search_intent: kw.search_intent || 'informational',
      suggested_publish_date: kw.suggested_publish_date || null,
      sequence_order: index + 1,
      status: CLUSTER_KEYWORD_STATUS.PENDING,
    }));
    await ClusterKeyword.bulkCreate(keywordRows);
  }

  return KeywordCluster.findByPk(cluster.id, { include: [{ association: 'keywords' }] });
}

async function updateCluster(id, patch) {
  const { KeywordCluster } = require('../models');
  const cluster = await KeywordCluster.findByPk(id);
  if (!cluster) throw ApiError.notFound('Cluster not found.');

  await cluster.update(patch);
  return cluster;
}

async function deleteCluster(id) {
  const { KeywordCluster } = require('../models');
  const cluster = await KeywordCluster.findByPk(id);
  if (!cluster) throw ApiError.notFound('Cluster not found.');

  await cluster.destroy();
  return { id: Number(id), deleted: true };
}

// ---------------------------------------------------------------------------
// Expansion (AI-powered sub-keyword generation)
// ---------------------------------------------------------------------------

/**
 * Pure prompt builder — split out from the AI-call + persist logic so the
 * Cluster Agent's propose_expand_with_keywords tool can build the same
 * prompt and do its own AI call, returning candidates as a proposal instead
 * of persisting them the way the one-click REST `expand` endpoint does.
 */
function buildExpandPrompt({ headKeyword, isSeasonal, seasonalPeakDate, count = 8 }) {
  return [
    `You are an SEO content strategist for Divinetalk, an astrology platform.`,
    ``,
    `Head keyword: "${headKeyword}"`,
    isSeasonal ? `This is a seasonal topic with peak date: ${seasonalPeakDate}` : '',
    ``,
    `Generate ${count} semantically related sub-keywords that collectively cover the full search surface around the head keyword.`,
    `For each sub-keyword provide:`,
    `- The keyword phrase (long-tail, specific)`,
    `- Search intent (informational, commercial, transactional, or navigational)`,
    `- A suggested publish date relative to today or to the seasonal peak (YYYY-MM-DD format)`,
    `- A brief rationale for the timing (1 sentence)`,
    ``,
    `Order them by recommended publication sequence (pillar/foundational content first, then supporting/seasonal).`,
    ``,
    `Respond ONLY with JSON in this shape:`,
    `{"keywords": [{"keyword": "string", "search_intent": "informational|commercial|transactional|navigational", "suggested_publish_date": "YYYY-MM-DD", "rationale": "string"}]}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Parses the raw completion text into a clean suggestions array. Throws on unparseable output. */
function parseExpandSuggestions(raw) {
  let suggestions = [];
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      suggestions = Array.isArray(parsed.keywords) ? parsed.keywords : [];
    }
  } catch {
    throw ApiError.upstream('Failed to parse cluster expansion response from AI provider.');
  }
  return suggestions;
}

/**
 * The ONE insert path for AI-suggested cluster keywords — called by both
 * `expandCluster` (REST, immediate) and the Cluster Agent's apply step
 * (proposal, after a human confirms).
 */
async function createExpandKeywords(clusterId, suggestions) {
  const { ClusterKeyword } = require('../models');
  const existingCount = await ClusterKeyword.count({ where: { cluster_id: clusterId } });
  const newKeywords = [];

  for (let i = 0; i < suggestions.length; i += 1) {
    const s = suggestions[i];
    if (!s.keyword || typeof s.keyword !== 'string') continue;
    // eslint-disable-next-line no-await-in-loop -- sequence_order depends on the running count, one row at a time.
    const row = await ClusterKeyword.create({
      cluster_id: clusterId,
      keyword: s.keyword.trim(),
      search_intent: EXPAND_SEARCH_INTENTS.includes(s.search_intent) ? s.search_intent : 'informational',
      suggested_publish_date: null,
      scheduled_generation_date: null,
      sequence_order: existingCount + i + 1,
      status: CLUSTER_KEYWORD_STATUS.PENDING,
    });
    newKeywords.push({ ...row.toJSON(), rationale: s.rationale || null });
  }

  return newKeywords;
}

/** REST path: builds the prompt, calls the AI provider, and persists immediately (one-click "Expand"). */
async function expandCluster(id, { count = 8 } = {}) {
  const { KeywordCluster } = require('../models');
  const cluster = await KeywordCluster.findByPk(id);
  if (!cluster) throw ApiError.notFound('Cluster not found.');

  const prompt = buildExpandPrompt({
    headKeyword: cluster.head_keyword,
    isSeasonal: cluster.is_seasonal,
    seasonalPeakDate: cluster.seasonal_peak_date,
    count,
  });

  const raw = await getTextProvider().complete({ operation: 'expandCluster', prompt, temperature: 0.7, maxTokens: 2000 });
  const suggestions = parseExpandSuggestions(raw);
  const newKeywords = await createExpandKeywords(cluster.id, suggestions);

  return { cluster_id: Number(cluster.id), added: newKeywords.length, keywords: newKeywords };
}

// ---------------------------------------------------------------------------
// Keyword management
// ---------------------------------------------------------------------------

/**
 * Bug fix vs. the original controller: checks the unique-date constraint
 * BEFORE writing, and catches the underlying race if one still slips through
 * — the original had no conflict handling at all here.
 */
async function updateKeyword(clusterId, keywordId, patch) {
  const { KeywordCluster, ClusterKeyword } = require('../models');
  const cluster = await KeywordCluster.findByPk(clusterId);
  if (!cluster) throw ApiError.notFound('Cluster not found.');

  const keyword = await ClusterKeyword.findOne({ where: { id: keywordId, cluster_id: clusterId } });
  if (!keyword) throw ApiError.notFound('Cluster keyword not found.');

  const payload = { ...patch };

  if (payload.scheduled_generation_date) {
    const conflict = await checkTimeSlot({
      datetime: payload.scheduled_generation_date,
      excludeKeywordId: keyword.id,
    });
    if (!conflict.available) {
      throw ApiError.conflict(
        `That time slot is already taken by keyword "${conflict.conflict.keyword}".`,
        { code: 'TIME_SLOT_TAKEN', details: conflict.conflict }
      );
    }
  }

  // Auto-transition status to SCHEDULED when a generation date is set on a pending keyword.
  if (payload.scheduled_generation_date && keyword.status === CLUSTER_KEYWORD_STATUS.PENDING) {
    payload.status = CLUSTER_KEYWORD_STATUS.SCHEDULED;
  }
  // If generation date is removed, revert to pending (unless already generated/published).
  if (payload.scheduled_generation_date === null && keyword.status === CLUSTER_KEYWORD_STATUS.SCHEDULED) {
    payload.status = CLUSTER_KEYWORD_STATUS.PENDING;
  }

  try {
    await keyword.update(payload);
  } catch (err) {
    if (isUniqueDateConflict(err)) {
      throw ApiError.conflict('That time slot was taken by another change just now — try again.', {
        code: 'TIME_SLOT_TAKEN',
      });
    }
    throw err;
  }

  return keyword;
}

async function removeKeyword(clusterId, keywordId) {
  const { KeywordCluster, ClusterKeyword } = require('../models');
  const cluster = await KeywordCluster.findByPk(clusterId);
  if (!cluster) throw ApiError.notFound('Cluster not found.');

  const keyword = await ClusterKeyword.findOne({ where: { id: keywordId, cluster_id: clusterId } });
  if (!keyword) throw ApiError.notFound('Cluster keyword not found.');

  await keyword.destroy();
  return { success: true };
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/** @param {{datetime: string, excludeKeywordId?: number}} args */
async function checkTimeSlot({ datetime, excludeKeywordId } = {}) {
  const { ClusterKeyword } = require('../models');
  if (!datetime) throw ApiError.badRequest('datetime is required.');

  const parsedDate = new Date(datetime);
  if (Number.isNaN(parsedDate.getTime())) throw ApiError.badRequest('Invalid datetime format.');

  const where = { scheduled_generation_date: parsedDate };
  if (excludeKeywordId) where.id = { [Op.ne]: Number(excludeKeywordId) };

  const existing = await ClusterKeyword.findOne({
    where,
    include: [{ association: 'cluster', attributes: ['id', 'name'] }],
    attributes: ['id', 'keyword', 'cluster_id'],
  });

  if (!existing) return { available: true };

  return {
    available: false,
    conflict: {
      keyword_id: Number(existing.id),
      keyword: existing.keyword,
      cluster_id: Number(existing.cluster_id),
      cluster_name: existing.cluster?.name || null,
    },
  };
}

/**
 * Bulk-writes scheduled_generation_date/suggested_publish_date. Bug fix vs.
 * the original: a unique-constraint race on the `.save()` call itself (not
 * just the pre-check) is now caught and reported as a per-entry conflict
 * instead of throwing and failing the whole batch.
 *
 * @param {number} clusterId
 * @param {Array<{id:number, scheduled_generation_date?:string|null, suggested_publish_date?:string|null}>} keywords
 */
async function scheduleAll(clusterId, keywords) {
  const { KeywordCluster, ClusterKeyword } = require('../models');
  const cluster = await KeywordCluster.findByPk(clusterId);
  if (!cluster) throw ApiError.notFound('Cluster not found.');
  if (cluster.status !== CLUSTER_STATUS.ACTIVE && cluster.status !== CLUSTER_STATUS.PLANNING) {
    throw ApiError.badRequest('Cluster must be in planning or active status to schedule keywords.');
  }
  if (!Array.isArray(keywords) || keywords.length === 0) {
    throw ApiError.badRequest('keywords array is required and must not be empty.');
  }

  const updated = [];
  const conflicts = [];

  for (const entry of keywords) {
    // eslint-disable-next-line no-await-in-loop -- each entry's conflict check must land before the next.
    const kw = await ClusterKeyword.findOne({ where: { id: entry.id, cluster_id: cluster.id } });
    if (!kw) continue;

    if ([CLUSTER_KEYWORD_STATUS.GENERATING, CLUSTER_KEYWORD_STATUS.GENERATED, CLUSTER_KEYWORD_STATUS.PUBLISHED].includes(kw.status)) {
      conflicts.push({ id: Number(kw.id), keyword: kw.keyword, reason: `Cannot schedule — status is "${kw.status}".` });
      continue;
    }

    const genDate = entry.scheduled_generation_date ? new Date(entry.scheduled_generation_date) : null;

    if (genDate) {
      // eslint-disable-next-line no-await-in-loop
      const existing = await ClusterKeyword.findOne({
        where: { scheduled_generation_date: genDate, id: { [Op.ne]: kw.id } },
      });
      if (existing) {
        conflicts.push({
          id: Number(kw.id),
          keyword: kw.keyword,
          reason: `Time slot taken by keyword "${existing.keyword}" (id: ${existing.id}).`,
        });
        continue;
      }
    }

    kw.scheduled_generation_date = genDate;
    kw.suggested_publish_date =
      entry.suggested_publish_date !== undefined
        ? entry.suggested_publish_date
          ? new Date(entry.suggested_publish_date)
          : null
        : kw.suggested_publish_date;

    if (genDate && kw.status === CLUSTER_KEYWORD_STATUS.PENDING) {
      kw.status = CLUSTER_KEYWORD_STATUS.SCHEDULED;
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      await kw.save();
      updated.push(kw.toJSON());
    } catch (err) {
      if (isUniqueDateConflict(err)) {
        conflicts.push({ id: Number(kw.id), keyword: kw.keyword, reason: 'That time slot was taken by another change just now.' });
        continue;
      }
      throw err;
    }
  }

  return { updated: updated.length, conflicts: conflicts.length, keywords: updated, conflict_details: conflicts };
}

/**
 * Pure preview computation — no writes. Renamed from the controller's
 * `autoSchedule` for clarity, since it never persists (the write is
 * `scheduleAll`, a genuinely separate step, matching the existing UI's
 * "Preview then Confirm & Apply" flow exactly).
 */
async function previewAutoSchedule(clusterId, { startDate, postsPerWeek, preferredTime = '10:00', bufferDays = 2 } = {}) {
  const { KeywordCluster, ClusterKeyword } = require('../models');
  const cluster = await KeywordCluster.findByPk(clusterId, {
    include: [{ association: 'keywords', where: { status: CLUSTER_KEYWORD_STATUS.PENDING }, required: false }],
  });
  if (!cluster) throw ApiError.notFound('Cluster not found.');
  if (!startDate) throw ApiError.badRequest('start_date is required.');

  const postsPerWeekResolved = postsPerWeek || cluster.cadence_posts_per_week || 2;
  const pendingKeywords = (cluster.keywords || []).sort((a, b) => a.sequence_order - b.sequence_order);

  if (pendingKeywords.length === 0) {
    return { schedule: [], message: 'No pending keywords to schedule.' };
  }

  const gapMs = (7 / postsPerWeekResolved) * 24 * 60 * 60 * 1000;
  const [hours, minutes] = preferredTime.split(':').map(Number);

  let cursor = new Date(startDate);
  cursor.setHours(hours || 10, minutes || 0, 0, 0);

  const schedule = [];

  for (const kw of pendingKeywords) {
    let attempts = 0;
    while (attempts < 48) {
      // eslint-disable-next-line no-await-in-loop -- each slot bump depends on the previous check.
      const existing = await ClusterKeyword.findOne({
        where: { scheduled_generation_date: cursor, id: { [Op.ne]: kw.id } },
      });
      if (!existing) break;
      cursor = new Date(cursor.getTime() + 30 * 60 * 1000);
      attempts += 1;
    }

    const publishDate = new Date(cursor.getTime() + bufferDays * 24 * 60 * 60 * 1000);
    publishDate.setHours(9, 0, 0, 0);

    schedule.push({
      id: Number(kw.id),
      keyword: kw.keyword,
      scheduled_generation_date: cursor.toISOString(),
      suggested_publish_date: publishDate.toISOString(),
    });

    cursor = new Date(cursor.getTime() + gapMs);
    cursor.setHours(hours || 10, minutes || 0, 0, 0);
  }

  return { schedule, posts_per_week: postsPerWeekResolved, buffer_days: bufferDays, preferred_time: preferredTime };
}

module.exports = {
  listClusters,
  getClusterDetail,
  createCluster,
  updateCluster,
  deleteCluster,
  buildExpandPrompt,
  parseExpandSuggestions,
  createExpandKeywords,
  expandCluster,
  updateKeyword,
  removeKeyword,
  checkTimeSlot,
  scheduleAll,
  previewAutoSchedule,
};
