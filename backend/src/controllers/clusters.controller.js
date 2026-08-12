'use strict';

const asyncHandler = require('../utils/asyncHandler');
const clusterService = require('../services/clusterService');
const { checkCannibalization } = require('../services/cannibalizationCheck');

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/clusters
 * Paginated list with optional status/search filters.
 */
const list = asyncHandler(async (req, res) => {
  const result = await clusterService.listClusters(req.query);
  res.json(result);
});

/**
 * GET /api/v1/clusters/:id
 * Full cluster detail with all keywords and their assigned blogs.
 */
const show = asyncHandler(async (req, res) => {
  const cluster = await clusterService.getClusterDetail(req.params.id);
  res.json({ data: cluster });
});

/**
 * POST /api/v1/clusters
 * Create a new cluster, optionally with initial keywords.
 */
const create = asyncHandler(async (req, res) => {
  const result = await clusterService.createCluster(req.body);
  res.status(201).json({ data: result });
});

/**
 * PATCH /api/v1/clusters/:id
 * Partial update of cluster metadata.
 */
const update = asyncHandler(async (req, res) => {
  const cluster = await clusterService.updateCluster(req.params.id, req.body);
  res.json({ data: cluster });
});

/**
 * DELETE /api/v1/clusters/:id
 * Deletes the cluster and cascades to its keywords (FK ON DELETE CASCADE).
 */
const remove = asyncHandler(async (req, res) => {
  const result = await clusterService.deleteCluster(req.params.id);
  res.json({ data: result });
});

// ---------------------------------------------------------------------------
// Expansion (AI-powered sub-keyword generation)
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/clusters/:id/expand
 * Uses Claude to suggest sub-keywords for the cluster's head keyword, and
 * persists them immediately (this one-click REST path is unchanged; only the
 * Cluster Agent's chat-driven equivalent proposes before persisting).
 */
const expand = asyncHandler(async (req, res) => {
  const { count = 8 } = req.body;
  const result = await clusterService.expandCluster(req.params.id, { count });
  res.json({ data: result });
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
  const keyword = await clusterService.updateKeyword(id, keywordId, req.body);
  res.json({ data: keyword });
});

/**
 * DELETE /api/v1/clusters/:id/keywords/:keywordId
 * Remove a specific keyword from a cluster.
 */
const removeKeyword = asyncHandler(async (req, res) => {
  const { id, keywordId } = req.params;
  const result = await clusterService.removeKeyword(id, keywordId);
  res.json({ data: result });
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
  const result = await clusterService.checkTimeSlot({
    datetime,
    excludeKeywordId: exclude_keyword_id,
  });
  res.json({ data: result });
});

/**
 * POST /api/v1/clusters/:id/schedule-all
 * Bulk-set scheduled_generation_date and suggested_publish_date for keywords.
 *
 * Body: { keywords: [{ id, scheduled_generation_date, suggested_publish_date? }] }
 */
const scheduleAll = asyncHandler(async (req, res) => {
  const result = await clusterService.scheduleAll(req.params.id, req.body.keywords);
  res.json({ data: result });
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
  const { start_date, posts_per_week, preferred_time, buffer_days } = req.body;
  const result = await clusterService.previewAutoSchedule(req.params.id, {
    startDate: start_date,
    postsPerWeek: posts_per_week,
    preferredTime: preferred_time,
    bufferDays: buffer_days,
  });
  res.json({ data: result });
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
