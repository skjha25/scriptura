'use strict';

const { Op } = require('sequelize');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { KeywordCluster, ClusterKeyword, Blog } = require('../models');
const { getTextProvider } = require('../services/ai');
const { checkCannibalization } = require('../services/cannibalizationCheck');
const { CLUSTER_KEYWORD_STATUS, CLUSTER_STATUS } = require('../constants');

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/clusters
 * Paginated list with optional status/search filters.
 */
const list = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status, q } = req.query;
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

  res.json({
    data,
    pagination: { total: count, page, limit, pages: Math.ceil(count / limit) },
  });
});

/**
 * GET /api/v1/clusters/:id
 * Full cluster detail with all keywords and their assigned blogs.
 */
const show = asyncHandler(async (req, res) => {
  const cluster = await KeywordCluster.findByPk(req.params.id, {
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
  res.json({ data: cluster });
});

/**
 * POST /api/v1/clusters
 * Create a new cluster, optionally with initial keywords.
 */
const create = asyncHandler(async (req, res) => {
  const { keywords: initialKeywords, ...clusterData } = req.body;

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

  // Reload with keywords included in the response.
  const result = await KeywordCluster.findByPk(cluster.id, {
    include: [{ association: 'keywords' }],
  });

  res.status(201).json({ data: result });
});

/**
 * PATCH /api/v1/clusters/:id
 * Partial update of cluster metadata.
 */
const update = asyncHandler(async (req, res) => {
  const cluster = await KeywordCluster.findByPk(req.params.id);
  if (!cluster) throw ApiError.notFound('Cluster not found.');

  await cluster.update(req.body);
  res.json({ data: cluster });
});

/**
 * DELETE /api/v1/clusters/:id
 * Deletes the cluster and cascades to its keywords (FK ON DELETE CASCADE).
 */
const remove = asyncHandler(async (req, res) => {
  const cluster = await KeywordCluster.findByPk(req.params.id);
  if (!cluster) throw ApiError.notFound('Cluster not found.');

  await cluster.destroy();
  res.json({ data: { id: Number(req.params.id), deleted: true } });
});

// ---------------------------------------------------------------------------
// Expansion (AI-powered sub-keyword generation)
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/clusters/:id/expand
 * Uses Claude to suggest sub-keywords for the cluster's head keyword.
 * If SerpAPI is available, enriches with People Also Ask data first.
 */
const expand = asyncHandler(async (req, res) => {
  const cluster = await KeywordCluster.findByPk(req.params.id);
  if (!cluster) throw ApiError.notFound('Cluster not found.');

  const { count = 8 } = req.body;
  const textProvider = getTextProvider();

  // Build prompt asking for sub-keywords with intent and timing.
  const prompt = [
    `You are an SEO content strategist for Divinetalk, an astrology platform.`,
    ``,
    `Head keyword: "${cluster.head_keyword}"`,
    cluster.is_seasonal ? `This is a seasonal topic with peak date: ${cluster.seasonal_peak_date}` : '',
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
  ].filter(Boolean).join('\n');

  const raw = await textProvider.complete({
    operation: 'expandCluster',
    prompt,
    temperature: 0.7,
    maxTokens: 2000,
  });

  // Parse the response.
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

  // Persist suggestions as pending cluster keywords (user can remove unwanted ones later).
  const existingCount = await ClusterKeyword.count({ where: { cluster_id: cluster.id } });
  const newKeywords = [];

  for (let i = 0; i < suggestions.length; i += 1) {
    const s = suggestions[i];
    if (!s.keyword || typeof s.keyword !== 'string') continue;
    const row = await ClusterKeyword.create({
      cluster_id: cluster.id,
      keyword: s.keyword.trim(),
      search_intent: ['informational', 'commercial', 'transactional', 'navigational'].includes(s.search_intent)
        ? s.search_intent
        : 'informational',
      suggested_publish_date: null,
      scheduled_generation_date: null,
      sequence_order: existingCount + i + 1,
      status: CLUSTER_KEYWORD_STATUS.PENDING,
    });
    newKeywords.push({ ...row.toJSON(), rationale: s.rationale || null });
  }

  res.json({
    data: {
      cluster_id: Number(cluster.id),
      added: newKeywords.length,
      keywords: newKeywords,
    },
  });
});

// ---------------------------------------------------------------------------
// Cannibalization check
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/clusters/check-cannibalization
 * Advisory endpoint — surfaces overlapping published blogs for a candidate keyword.
 */
const cannibalization = asyncHandler(async (req, res) => {
  const { keyword, secondary_keywords = [], exclude_blog_id } = req.body;

  const result = await checkCannibalization({
    keyword,
    secondaryKeywords: secondary_keywords,
    excludeBlogId: exclude_blog_id || null,
  });

  res.json({ data: result });
});

// ---------------------------------------------------------------------------
// Keyword Management
// ---------------------------------------------------------------------------

/**
 * PATCH /api/v1/clusters/:id/keywords/:keywordId
 * Update a specific keyword within a cluster.
 */
const updateKeyword = asyncHandler(async (req, res) => {
  const { id, keywordId } = req.params;
  const cluster = await KeywordCluster.findByPk(id);
  if (!cluster) throw ApiError.notFound('Cluster not found.');

  const keyword = await ClusterKeyword.findOne({ where: { id: keywordId, cluster_id: id } });
  if (!keyword) throw ApiError.notFound('Cluster keyword not found.');

  // Auto-transition status to SCHEDULED when a generation date is set on a pending keyword.
  const payload = { ...req.body };
  if (
    payload.scheduled_generation_date &&
    keyword.status === CLUSTER_KEYWORD_STATUS.PENDING
  ) {
    payload.status = CLUSTER_KEYWORD_STATUS.SCHEDULED;
  }
  // If generation date is removed, revert to pending (unless already generated/published).
  if (
    payload.scheduled_generation_date === null &&
    keyword.status === CLUSTER_KEYWORD_STATUS.SCHEDULED
  ) {
    payload.status = CLUSTER_KEYWORD_STATUS.PENDING;
  }

  await keyword.update(payload);
  res.json({ data: keyword });
});

/**
 * DELETE /api/v1/clusters/:id/keywords/:keywordId
 * Remove a specific keyword from a cluster.
 */
const removeKeyword = asyncHandler(async (req, res) => {
  const { id, keywordId } = req.params;
  const cluster = await KeywordCluster.findByPk(id);
  if (!cluster) throw ApiError.notFound('Cluster not found.');

  const keyword = await ClusterKeyword.findOne({ where: { id: keywordId, cluster_id: id } });
  if (!keyword) throw ApiError.notFound('Cluster keyword not found.');

  await keyword.destroy();
  res.json({ data: { success: true } });
});

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/clusters/check-time-slot
 * Checks if a given datetime is available for scheduling (no other keyword
 * occupies that exact time-slot).
 *
 * Query: ?datetime=2026-08-15T10:30:00
 */
const checkTimeSlot = asyncHandler(async (req, res) => {
  const { datetime, exclude_keyword_id } = req.query;
  if (!datetime) throw ApiError.badRequest('datetime query parameter is required.');

  const parsedDate = new Date(datetime);
  if (isNaN(parsedDate.getTime())) throw ApiError.badRequest('Invalid datetime format.');

  const where = {
    scheduled_generation_date: parsedDate,
  };

  // When editing an existing keyword's date, exclude it from the conflict check.
  if (exclude_keyword_id) {
    where.id = { [Op.ne]: Number(exclude_keyword_id) };
  }

  const existing = await ClusterKeyword.findOne({
    where,
    include: [{ association: 'cluster', attributes: ['id', 'name'] }],
    attributes: ['id', 'keyword', 'cluster_id'],
  });

  if (existing) {
    res.json({
      data: {
        available: false,
        conflict: {
          keyword_id: Number(existing.id),
          keyword: existing.keyword,
          cluster_id: Number(existing.cluster_id),
          cluster_name: existing.cluster?.name || null,
        },
      },
    });
  } else {
    res.json({ data: { available: true } });
  }
});

/**
 * POST /api/v1/clusters/:id/schedule-all
 * Bulk-set scheduled_generation_date and suggested_publish_date for keywords.
 *
 * Body: { keywords: [{ id, scheduled_generation_date, suggested_publish_date? }] }
 */
const scheduleAll = asyncHandler(async (req, res) => {
  const cluster = await KeywordCluster.findByPk(req.params.id);
  if (!cluster) throw ApiError.notFound('Cluster not found.');
  if (cluster.status !== CLUSTER_STATUS.ACTIVE && cluster.status !== CLUSTER_STATUS.PLANNING) {
    throw ApiError.badRequest('Cluster must be in planning or active status to schedule keywords.');
  }

  const { keywords } = req.body;
  if (!Array.isArray(keywords) || keywords.length === 0) {
    throw ApiError.badRequest('keywords array is required and must not be empty.');
  }

  const updated = [];
  const conflicts = [];

  for (const entry of keywords) {
    const kw = await ClusterKeyword.findOne({ where: { id: entry.id, cluster_id: cluster.id } });
    if (!kw) continue;

    // Cannot reschedule keywords that are already generating or beyond.
    if ([CLUSTER_KEYWORD_STATUS.GENERATING, CLUSTER_KEYWORD_STATUS.GENERATED, CLUSTER_KEYWORD_STATUS.PUBLISHED].includes(kw.status)) {
      conflicts.push({ id: Number(kw.id), keyword: kw.keyword, reason: `Cannot schedule — status is "${kw.status}".` });
      continue;
    }

    const genDate = entry.scheduled_generation_date ? new Date(entry.scheduled_generation_date) : null;

    // Check time-slot uniqueness before setting.
    if (genDate) {
      const existing = await ClusterKeyword.findOne({
        where: {
          scheduled_generation_date: genDate,
          id: { [Op.ne]: kw.id },
        },
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
    kw.suggested_publish_date = entry.suggested_publish_date !== undefined
      ? (entry.suggested_publish_date ? new Date(entry.suggested_publish_date) : null)
      : kw.suggested_publish_date;

    // If a generation date is set, mark as scheduled (if currently pending).
    if (genDate && kw.status === CLUSTER_KEYWORD_STATUS.PENDING) {
      kw.status = CLUSTER_KEYWORD_STATUS.SCHEDULED;
    }

    await kw.save();
    updated.push(kw.toJSON());
  }

  res.json({
    data: {
      updated: updated.length,
      conflicts: conflicts.length,
      keywords: updated,
      conflict_details: conflicts,
    },
  });
});

/**
 * POST /api/v1/clusters/:id/auto-schedule
 * Automatically computes generation and publish dates for all pending keywords
 * based on cadence, start date, and preferred time.
 *
 * Body: { start_date, posts_per_week?, preferred_time?, buffer_days? }
 * Returns a preview. Call schedule-all to apply.
 */
const autoSchedule = asyncHandler(async (req, res) => {
  const cluster = await KeywordCluster.findByPk(req.params.id, {
    include: [{ association: 'keywords', where: { status: CLUSTER_KEYWORD_STATUS.PENDING }, required: false }],
  });
  if (!cluster) throw ApiError.notFound('Cluster not found.');

  const {
    start_date,
    posts_per_week = cluster.cadence_posts_per_week || 2,
    preferred_time = '10:00',
    buffer_days = 2,
  } = req.body;

  if (!start_date) throw ApiError.badRequest('start_date is required.');

  const pendingKeywords = (cluster.keywords || [])
    .sort((a, b) => a.sequence_order - b.sequence_order);

  if (pendingKeywords.length === 0) {
    return res.json({ data: { schedule: [], message: 'No pending keywords to schedule.' } });
  }

  const gapMs = (7 / posts_per_week) * 24 * 60 * 60 * 1000;
  const [hours, minutes] = preferred_time.split(':').map(Number);

  let cursor = new Date(start_date);
  cursor.setHours(hours || 10, minutes || 0, 0, 0);

  const schedule = [];

  for (const kw of pendingKeywords) {
    // Check if this slot is taken and bump by 30min if so.
    let attempts = 0;
    while (attempts < 48) { // max 24 hours of 30-min slots
      const existing = await ClusterKeyword.findOne({
        where: {
          scheduled_generation_date: cursor,
          id: { [Op.ne]: kw.id },
        },
      });
      if (!existing) break;
      cursor = new Date(cursor.getTime() + 30 * 60 * 1000); // bump 30 min
      attempts += 1;
    }

    const publishDate = new Date(cursor.getTime() + buffer_days * 24 * 60 * 60 * 1000);
    publishDate.setHours(9, 0, 0, 0); // Publish at 9 AM IST

    schedule.push({
      id: Number(kw.id),
      keyword: kw.keyword,
      scheduled_generation_date: cursor.toISOString(),
      suggested_publish_date: publishDate.toISOString(),
    });

    // Advance cursor by the gap
    cursor = new Date(cursor.getTime() + gapMs);
    cursor.setHours(hours || 10, minutes || 0, 0, 0);
  }

  res.json({ data: { schedule, posts_per_week, buffer_days, preferred_time } });
});

module.exports = {
  list,
  show,
  create,
  update,
  remove,
  expand,
  cannibalization,
  updateKeyword,
  removeKeyword,
  checkTimeSlot,
  scheduleAll,
  autoSchedule,
};
