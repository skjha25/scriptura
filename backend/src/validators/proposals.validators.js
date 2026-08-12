'use strict';

/**
 * Zod schemas for POST /agents/proposals/apply.
 *
 * This is the entity-mutation counterpart to validators/agents.validators.js's
 * `applySettingBody` — that one writes `ScripturaSettings` keys, this one
 * dispatches into real domain tables (cluster rows, keyword pool, topics) via
 * services/clusterService.js and friends. Same safety invariant either way:
 * a discriminated union re-validates every field independently of whatever
 * the proposing tool claimed, so nothing an agent proposes reaches a table
 * without being checked here too.
 */

const { z } = require('zod');

const { CLUSTER_STATUS } = require('../constants');
const { datetimeString } = require('./cluster.validators');

const traceIdField = z.string().uuid().optional();
const clusterIdField = z.coerce.number().int().positive();

const topicsCreateTopics = z
  .object({
    action: z.literal('topics.create_topics'),
    topics: z.array(z.string().trim().min(1).max(255)).min(1).max(50),
    trace_id: traceIdField,
  })
  .strict();

// Matches models/scripturaKeyword.js's actual `search_intent` ENUM (3
// values) — NOT the 4-value SEARCH_INTENT constant clusters use.
const KEYWORD_SEARCH_INTENTS = ['informational', 'transactional', 'navigational'];

const keywordPoolCreateKeywords = z
  .object({
    action: z.literal('keyword_pool.create_keywords'),
    keywords: z
      .array(
        z.object({
          primary_keyword: z.string().trim().min(1).max(255),
          secondary_keywords: z.array(z.string().trim().min(1).max(255)).max(10).optional(),
          search_intent: z.enum(KEYWORD_SEARCH_INTENTS).optional(),
        })
      )
      .min(1)
      .max(50),
    trace_id: traceIdField,
  })
  .strict();

const clusterUpdateStatus = z
  .object({
    action: z.literal('cluster.update_status'),
    cluster_id: clusterIdField,
    status: z.enum(Object.values(CLUSTER_STATUS)),
    trace_id: traceIdField,
  })
  .strict();

// Same bounds as updateClusterBody in cluster.validators.js, restricted to
// the cadence/priority/lead-time/seasonal fields the Cluster Agent proposes
// — name/head_keyword/status/pillar_blog_id are out of this tool's scope
// (status has its own dedicated action above).
const clusterUpdateFields = z
  .object({
    action: z.literal('cluster.update_fields'),
    cluster_id: clusterIdField,
    cadence_posts_per_week: z.coerce.number().int().min(1).max(14).optional(),
    priority_score: z.coerce.number().int().min(0).max(100).optional(),
    lead_time_weeks: z.coerce.number().int().min(1).max(52).optional(),
    is_seasonal: z.boolean().optional(),
    seasonal_peak_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    trace_id: traceIdField,
  })
  .strict();

const clusterUpdateKeywordDate = z
  .object({
    action: z.literal('cluster.update_keyword_date'),
    cluster_id: clusterIdField,
    keyword_id: z.coerce.number().int().positive(),
    scheduled_generation_date: datetimeString.nullable(),
    trace_id: traceIdField,
  })
  .strict();

const clusterDeleteKeyword = z
  .object({
    action: z.literal('cluster.delete_keyword'),
    cluster_id: clusterIdField,
    keyword_id: z.coerce.number().int().positive(),
    trace_id: traceIdField,
  })
  .strict();

const clusterDeleteCluster = z
  .object({
    action: z.literal('cluster.delete_cluster'),
    cluster_id: clusterIdField,
    trace_id: traceIdField,
  })
  .strict();

// Matches scheduleAllBody's `keywords` shape in cluster.validators.js exactly
// (reused as the write-time re-validation for whatever previewAutoSchedule
// computed and the admin approved).
const clusterReschedule = z
  .object({
    action: z.literal('cluster.reschedule'),
    cluster_id: clusterIdField,
    schedule: z
      .array(
        z.object({
          id: z.coerce.number().int().positive(),
          scheduled_generation_date: datetimeString.nullable(),
          suggested_publish_date: datetimeString.nullable().optional(),
        })
      )
      .min(1)
      .max(50),
    trace_id: traceIdField,
  })
  .strict();

// Same 4 values expandClusterBody's underlying prompt asks for — NOT the
// 3-value ScripturaKeyword enum keyword_pool.create_keywords uses.
const CLUSTER_EXPAND_SEARCH_INTENTS = ['informational', 'commercial', 'transactional', 'navigational'];

const clusterExpand = z
  .object({
    action: z.literal('cluster.expand'),
    cluster_id: clusterIdField,
    keywords: z
      .array(
        z.object({
          keyword: z.string().trim().min(1).max(500),
          search_intent: z.enum(CLUSTER_EXPAND_SEARCH_INTENTS).optional(),
          rationale: z.string().trim().max(500).optional(),
        })
      )
      .min(1)
      .max(20),
    trace_id: traceIdField,
  })
  .strict();

/** POST /agents/proposals/apply — new branches are added as more agents ship. */
const applyProposalBody = z
  .discriminatedUnion('action', [
    topicsCreateTopics,
    keywordPoolCreateKeywords,
    clusterUpdateStatus,
    clusterUpdateFields,
    clusterUpdateKeywordDate,
    clusterDeleteKeyword,
    clusterDeleteCluster,
    clusterReschedule,
    clusterExpand,
  ], {
    errorMap: () => ({ message: 'action must be one of the known proposal actions.' }),
  })
  .superRefine((val, ctx) => {
    if (val.action !== 'cluster.update_fields') return;
    const { action, cluster_id, trace_id, ...fields } = val;
    if (Object.keys(fields).length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one field is required.' });
    }
  });

module.exports = {
  applyProposalBody,
};
