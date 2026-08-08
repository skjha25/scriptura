'use strict';

const { z } = require('zod');
const { CLUSTER_STATUS, CLUSTER_TYPE, SEARCH_INTENT } = require('../constants');

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const optionalText = (max) =>
  z.string().trim().max(max).transform((v) => (v === '' ? null : v)).nullable().optional();

const idParam = z.object({ id: z.coerce.number().int().positive() });

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/** POST /clusters — create a new cluster from a head keyword. */
const createClusterBody = z.object({
  name: z.string().trim().min(1).max(255),
  head_keyword: z.string().trim().min(1).max(255),
  cluster_type: z.enum(Object.values(CLUSTER_TYPE)).default('hub'),
  is_seasonal: z.boolean().default(false),
  seasonal_peak_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  lead_time_weeks: z.coerce.number().int().min(1).max(52).default(6),
  cadence_posts_per_week: z.coerce.number().int().min(1).max(14).default(2),
  priority_score: z.coerce.number().int().min(0).max(100).default(50),
  // Optional initial keywords to seed the cluster with.
  keywords: z.array(z.object({
    keyword: z.string().trim().min(1).max(500),
    search_intent: z.enum(Object.values(SEARCH_INTENT)).default('informational'),
    suggested_publish_date: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/).nullable().optional(),
  })).max(50).optional(),
}).strict();

/** PATCH /clusters/:id — partial update. */
const updateClusterBody = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  head_keyword: z.string().trim().min(1).max(255).optional(),
  cluster_type: z.enum(Object.values(CLUSTER_TYPE)).optional(),
  status: z.enum(Object.values(CLUSTER_STATUS)).optional(),
  is_seasonal: z.boolean().optional(),
  seasonal_peak_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  lead_time_weeks: z.coerce.number().int().min(1).max(52).optional(),
  cadence_posts_per_week: z.coerce.number().int().min(1).max(14).optional(),
  priority_score: z.coerce.number().int().min(0).max(100).optional(),
  pillar_blog_id: z.coerce.number().int().positive().nullable().optional(),
}).strict();

/** GET /clusters — list with filters. */
const listClustersQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(Object.values(CLUSTER_STATUS)).optional(),
  q: z.string().trim().max(255).optional(),
}).strict();

/** POST /clusters/:id/expand — ask AI for sub-keyword expansion. */
const expandClusterBody = z.object({
  count: z.coerce.number().int().min(3).max(20).default(8),
}).strict();

const keywordParam = z.object({
  id: z.coerce.number().int().positive(),
  keywordId: z.coerce.number().int().positive(),
});

const updateKeywordBody = z.object({
  keyword: z.string().trim().min(1).max(500).optional(),
  search_intent: z.enum(Object.values(SEARCH_INTENT)).optional(),
  suggested_publish_date: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/).nullable().optional(),
  scheduled_generation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/).nullable().optional(),
}).strict();

/** POST /clusters/check-cannibalization */
const checkCannibalizationBody = z.object({
  keyword: z.string().trim().min(1).max(255),
  secondary_keywords: z.array(z.string().trim().min(1).max(255)).max(20).default([]),
  exclude_blog_id: z.coerce.number().int().positive().optional(),
}).strict();

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

const datetimeString = z.string().regex(
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/
);

/** GET /clusters/check-time-slot?datetime=...&exclude_keyword_id=... */
const checkTimeSlotQuery = z.object({
  datetime: datetimeString,
  exclude_keyword_id: z.coerce.number().int().positive().optional(),
}).strict();

/** POST /clusters/:id/schedule-all — bulk set dates for keywords. */
const scheduleAllBody = z.object({
  keywords: z.array(z.object({
    id: z.coerce.number().int().positive(),
    scheduled_generation_date: datetimeString.nullable(),
    suggested_publish_date: datetimeString.nullable().optional(),
  })).min(1).max(50),
}).strict();

/** POST /clusters/:id/auto-schedule — compute dates automatically. */
const autoScheduleBody = z.object({
  start_date: datetimeString,
  posts_per_week: z.coerce.number().int().min(1).max(14).optional(),
  preferred_time: z.string().regex(/^\d{2}:\d{2}$/).default('10:00'),
  buffer_days: z.coerce.number().int().min(0).max(30).default(2),
}).strict();

module.exports = {
  createClusterBody,
  updateClusterBody,
  listClustersQuery,
  expandClusterBody,
  checkCannibalizationBody,
  checkTimeSlotQuery,
  scheduleAllBody,
  autoScheduleBody,
  idParam,
  keywordParam,
  updateKeywordBody,
};
