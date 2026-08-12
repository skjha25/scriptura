'use strict';

/**
 * Tools available to the Cluster Agent.
 *
 * Reads execute immediately — cannibalization/time-slot checks are
 * deterministic and side-effect-free, list/get are plain lookups. Writes
 * (added alongside this file as later tools) always propose first, via
 * POST /agents/proposals/apply, dispatching into services/clusterService.js
 * — the same functions the human-facing REST cluster controller uses.
 */

const CLUSTER_SEARCH_INTENTS = ['informational', 'commercial', 'transactional', 'navigational'];

/**
 * The model reasons about times in IST (matching the current-time hint
 * runAgentTurn.js stamps into the system prompt, and every date the admin
 * sees elsewhere in the app), but naturally emits bare ISO strings with no
 * timezone designator — e.g. "2026-08-11T14:02:00". Those get parsed as the
 * server's local time downstream (Sequelize -> `new Date(...)`), which on a
 * UTC-tz server lands every proposed slot 5:30 hours later than intended.
 * Stamping +05:30 onto anything that doesn't already carry an explicit
 * offset keeps agent-proposed dates lined up with what gets displayed —
 * matching ClusterDetailPage.js's fromLocalInput, which does the same for
 * manually-entered dates.
 */
function withIstOffset(value) {
  if (typeof value !== 'string' || !value) return value;
  if (/(Z|[+-]\d{2}:\d{2})$/.test(value)) return value; // already explicit
  if (!/T\d{2}:\d{2}/.test(value)) return value; // bare date, no time to offset
  return `${value}+05:30`;
}

const checkCannibalizationTool = {
  name: 'check_cannibalization',
  description:
    'Check whether a candidate keyword overlaps with an already-published article, before scheduling ' +
    'new content around it. Deterministic, no AI call — safe to call freely.',
  input_schema: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: 'The candidate primary keyword.' },
      secondary_keywords: { type: 'array', items: { type: 'string' }, description: 'Optional related keywords to widen the check.' },
      exclude_blog_id: { type: 'integer', description: 'Blog id to exclude from the check (e.g. when re-checking the blog that already owns this keyword).' },
    },
    required: ['keyword'],
  },
  async execute({ keyword, secondary_keywords = [], exclude_blog_id } = {}) {
    if (!keyword || !String(keyword).trim()) throw new Error('keyword is required.');
    const { checkCannibalization } = require('../../cannibalizationCheck');
    const result = await checkCannibalization({
      keyword: String(keyword).trim(),
      secondaryKeywords: Array.isArray(secondary_keywords) ? secondary_keywords : [],
      excludeBlogId: exclude_blog_id || null,
    });
    return { type: 'read', result };
  },
};

const checkTimeSlotTool = {
  name: 'check_time_slot',
  description:
    'Check whether a specific datetime is free for scheduling a keyword\'s article generation ' +
    '(the platform allows only one scheduled keyword per exact time-slot, platform-wide). Call this ' +
    'before proposing a specific date so you never propose one that will fail.',
  input_schema: {
    type: 'object',
    properties: {
      datetime: { type: 'string', description: 'ISO datetime to check, e.g. 2026-08-15T10:30:00.' },
      exclude_keyword_id: { type: 'integer', description: 'Keyword id to exclude from the conflict check (when re-checking a slot for a keyword that already occupies it).' },
    },
    required: ['datetime'],
  },
  async execute({ datetime, exclude_keyword_id } = {}) {
    const clusterService = require('../../clusterService');
    const result = await clusterService.checkTimeSlot({ datetime: withIstOffset(datetime), excludeKeywordId: exclude_keyword_id });
    return { type: 'read', result };
  },
};

const listClustersTool = {
  name: 'list_clusters',
  description: 'List keyword clusters, optionally filtered by status or a search term.',
  input_schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['planning', 'active', 'complete', 'paused'] },
      q: { type: 'string', description: 'Search by cluster name or head keyword.' },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
  },
  async execute({ status, q, limit } = {}) {
    const clusterService = require('../../clusterService');
    const result = await clusterService.listClusters({ status, q, limit: limit || 20 });
    return { type: 'read', clusters: result.data, pagination: result.pagination };
  },
};

const getClusterTool = {
  name: 'get_cluster',
  description: 'Read one cluster in full detail, including all its keywords and their status/scheduling.',
  input_schema: {
    type: 'object',
    properties: {
      cluster_id: { type: 'integer' },
    },
    required: ['cluster_id'],
  },
  async execute({ cluster_id } = {}) {
    const clusterService = require('../../clusterService');
    const cluster = await clusterService.getClusterDetail(cluster_id);
    return { type: 'read', cluster };
  },
};

const proposeClusterStatusChange = {
  name: 'propose_cluster_status_change',
  description:
    'Propose changing a cluster\'s status (planning, active, complete, paused). Only active clusters ' +
    'are picked up by the autopilot scheduler, so pausing/activating changes whether scheduled ' +
    'keywords actually fire — this is not immediately visible the way a keyword date is, so it is ' +
    'always proposed first, never applied directly.',
  input_schema: {
    type: 'object',
    properties: {
      cluster_id: { type: 'integer' },
      status: { type: 'string', enum: ['planning', 'active', 'complete', 'paused'] },
    },
    required: ['cluster_id', 'status'],
  },
  async execute({ cluster_id, status } = {}) {
    const clusterService = require('../../clusterService');
    const cluster = await clusterService.getClusterDetail(cluster_id);
    return {
      type: 'proposed_change',
      change: {
        domain: 'cluster',
        action: 'cluster.update_status',
        key: 'cluster.update_status',
        cluster_id,
        current_value: cluster.status,
        proposed_value: status,
      },
      message: `Proposed changing cluster #${cluster_id} status from "${cluster.status}" to "${status}" — nothing has been applied yet.`,
    };
  },
};

const proposeClusterFieldsUpdate = {
  name: 'propose_cluster_fields_update',
  description:
    'Propose changing a cluster\'s cadence (posts/week), priority score, lead time, or seasonal ' +
    'settings. Only proposes a diff for the admin to review; never applies it.',
  input_schema: {
    type: 'object',
    properties: {
      cluster_id: { type: 'integer' },
      cadence_posts_per_week: { type: 'integer', minimum: 1, maximum: 14 },
      priority_score: { type: 'integer', minimum: 0, maximum: 100 },
      lead_time_weeks: { type: 'integer', minimum: 1, maximum: 52 },
      is_seasonal: { type: 'boolean' },
      seasonal_peak_date: { type: 'string', description: 'YYYY-MM-DD, only if is_seasonal is true.' },
    },
    required: ['cluster_id'],
  },
  async execute({ cluster_id, ...fields } = {}) {
    const proposedFields = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    if (Object.keys(proposedFields).length === 0) {
      throw new Error('At least one field (cadence_posts_per_week, priority_score, lead_time_weeks, is_seasonal, seasonal_peak_date) is required.');
    }

    const clusterService = require('../../clusterService');
    const cluster = await clusterService.getClusterDetail(cluster_id);
    const currentValue = Object.fromEntries(Object.keys(proposedFields).map((key) => [key, cluster[key]]));

    return {
      type: 'proposed_change',
      change: {
        domain: 'cluster',
        action: 'cluster.update_fields',
        key: 'cluster.update_fields',
        cluster_id,
        current_value: currentValue,
        proposed_value: proposedFields,
      },
      message: `Proposed field changes for cluster #${cluster_id} — nothing has been applied yet.`,
    };
  },
};

const proposeUpdateKeywordDate = {
  name: 'propose_update_keyword_date',
  description:
    'Propose a new scheduled-generation date for one keyword. Automatically checks the time slot is ' +
    'free before proposing, so you never propose a date that will fail. Only proposes a diff; never ' +
    'applies it.',
  input_schema: {
    type: 'object',
    properties: {
      cluster_id: { type: 'integer' },
      keyword_id: { type: 'integer' },
      scheduled_generation_date: { type: 'string', description: 'ISO datetime, or null to clear the schedule.' },
    },
    required: ['cluster_id', 'keyword_id', 'scheduled_generation_date'],
  },
  async execute({ cluster_id, keyword_id, scheduled_generation_date } = {}) {
    const clusterService = require('../../clusterService');
    const normalizedDate = withIstOffset(scheduled_generation_date);

    if (normalizedDate) {
      const slot = await clusterService.checkTimeSlot({
        datetime: normalizedDate,
        excludeKeywordId: keyword_id,
      });
      if (!slot.available) {
        throw new Error(
          `That time slot is already taken by keyword "${slot.conflict.keyword}" — check_time_slot again with a different time.`
        );
      }
    }

    const cluster = await clusterService.getClusterDetail(cluster_id);
    const existing = (cluster.keywords || []).find((k) => Number(k.id) === Number(keyword_id));
    if (!existing) throw new Error(`Keyword #${keyword_id} not found on cluster #${cluster_id}.`);

    return {
      type: 'proposed_change',
      change: {
        domain: 'cluster',
        action: 'cluster.update_keyword_date',
        key: 'cluster.update_keyword_date',
        cluster_id,
        keyword_id,
        current_value: existing.scheduled_generation_date,
        proposed_value: normalizedDate,
      },
      message: `Proposed rescheduling keyword "${existing.keyword}" — nothing has been applied yet.`,
    };
  },
};

const proposeDeleteKeyword = {
  name: 'propose_delete_keyword',
  description:
    'Propose deleting one keyword from a cluster. Genuinely irreversible — no undo path exists. ' +
    'Only proposes it for the admin to review; never deletes it itself.',
  input_schema: {
    type: 'object',
    properties: {
      cluster_id: { type: 'integer' },
      keyword_id: { type: 'integer' },
    },
    required: ['cluster_id', 'keyword_id'],
  },
  async execute({ cluster_id, keyword_id } = {}) {
    const clusterService = require('../../clusterService');
    const cluster = await clusterService.getClusterDetail(cluster_id);
    const existing = (cluster.keywords || []).find((k) => Number(k.id) === Number(keyword_id));
    if (!existing) throw new Error(`Keyword #${keyword_id} not found on cluster #${cluster_id}.`);

    return {
      type: 'proposed_change',
      change: {
        domain: 'cluster',
        action: 'cluster.delete_keyword',
        key: 'cluster.delete_keyword',
        cluster_id,
        keyword_id,
        current_value: existing.keyword,
        proposed_value: null,
        revertible: false,
      },
      message: `Proposed deleting keyword "${existing.keyword}" — this cannot be undone once applied. Nothing has been applied yet.`,
    };
  },
};

const proposeDeleteCluster = {
  name: 'propose_delete_cluster',
  description:
    'Propose deleting an entire cluster and all its keywords. Genuinely irreversible. Only proposes ' +
    'it for the admin to review; never deletes it itself.',
  input_schema: {
    type: 'object',
    properties: {
      cluster_id: { type: 'integer' },
    },
    required: ['cluster_id'],
  },
  async execute({ cluster_id } = {}) {
    const clusterService = require('../../clusterService');
    const cluster = await clusterService.getClusterDetail(cluster_id);

    return {
      type: 'proposed_change',
      change: {
        domain: 'cluster',
        action: 'cluster.delete_cluster',
        key: 'cluster.delete_cluster',
        cluster_id,
        current_value: cluster.name,
        proposed_value: null,
        revertible: false,
      },
      message: `Proposed deleting cluster "${cluster.name}" and all ${cluster.keywords?.length || 0} of its keywords — this cannot be undone once applied. Nothing has been applied yet.`,
    };
  },
};

const proposeReschedule = {
  name: 'propose_reschedule',
  description:
    'Propose new generation/publish dates for a cluster\'s pending keywords, spaced out at a given ' +
    'cadence starting from a date — the same computation the "Auto-Schedule" preview already does. ' +
    'Only proposes the computed schedule; never writes it. Applying touches every pending keyword at ' +
    'once, so review the full list before confirming.',
  input_schema: {
    type: 'object',
    properties: {
      cluster_id: { type: 'integer' },
      start_date: { type: 'string', description: 'ISO date/datetime to start scheduling from.' },
      posts_per_week: {
        type: 'integer',
        minimum: 1,
        maximum: 14,
        description: "How many posts per week (default: the cluster's own cadence setting, or 2).",
      },
      preferred_time: { type: 'string', description: 'HH:MM 24h time of day for generation (default 10:00).' },
      buffer_days: {
        type: 'integer',
        minimum: 0,
        maximum: 30,
        description: 'Days between generation and suggested publish date (default 2).',
      },
    },
    required: ['cluster_id', 'start_date'],
  },
  async execute({ cluster_id, start_date, posts_per_week, preferred_time, buffer_days } = {}) {
    const clusterService = require('../../clusterService');
    const preview = await clusterService.previewAutoSchedule(cluster_id, {
      startDate: start_date,
      postsPerWeek: posts_per_week,
      preferredTime: preferred_time,
      bufferDays: buffer_days,
    });

    if (!preview.schedule || preview.schedule.length === 0) {
      throw new Error(preview.message || 'No pending keywords to schedule for this cluster.');
    }

    return {
      type: 'proposed_change',
      change: {
        domain: 'cluster',
        action: 'cluster.reschedule',
        key: 'cluster.reschedule',
        cluster_id,
        current_value: null,
        proposed_value: preview.schedule,
      },
      message: `Proposed a new schedule for ${preview.schedule.length} keyword${preview.schedule.length === 1 ? '' : 's'} — nothing has been applied yet.`,
    };
  },
};

const proposeExpandWithKeywords = {
  name: 'propose_expand_with_keywords',
  description:
    "Ask AI to suggest new sub-keywords for a cluster's head keyword — the same suggestion prompt the " +
    'one-click "Expand" button uses, but unlike that button, this only proposes the candidates for the ' +
    'admin to review; it never adds them to the cluster itself.',
  input_schema: {
    type: 'object',
    properties: {
      cluster_id: { type: 'integer' },
      count: {
        type: 'integer',
        minimum: 3,
        maximum: 20,
        description: 'How many keyword candidates to suggest (default 8).',
      },
    },
    required: ['cluster_id'],
  },
  async execute({ cluster_id, count } = {}) {
    const clusterService = require('../../clusterService');
    const cluster = await clusterService.getClusterDetail(cluster_id);
    const n = Number.isInteger(count) && count >= 3 && count <= 20 ? count : 8;

    const prompt = clusterService.buildExpandPrompt({
      headKeyword: cluster.head_keyword,
      isSeasonal: cluster.is_seasonal,
      seasonalPeakDate: cluster.seasonal_peak_date,
      count: n,
    });

    const { getTextProvider } = require('../../ai');
    const provider = getTextProvider();
    const raw = await provider.complete({ operation: 'agentExpandCluster', prompt, temperature: 0.7, maxTokens: 2000 });
    const suggestions = clusterService.parseExpandSuggestions(raw);

    const cleaned = suggestions
      .filter((s) => s && typeof s.keyword === 'string' && s.keyword.trim())
      .slice(0, n)
      .map((s) => ({
        keyword: s.keyword.trim(),
        search_intent: CLUSTER_SEARCH_INTENTS.includes(s.search_intent) ? s.search_intent : 'informational',
        rationale: typeof s.rationale === 'string' ? s.rationale.slice(0, 500) : undefined,
      }));

    if (cleaned.length === 0) {
      throw new Error('The model returned no usable keyword suggestions.');
    }

    return {
      type: 'proposed_change',
      change: {
        domain: 'cluster',
        action: 'cluster.expand',
        key: 'cluster.expand',
        cluster_id,
        current_value: null,
        proposed_value: cleaned,
      },
      message: `Proposed ${cleaned.length} new keyword${cleaned.length === 1 ? '' : 's'} for cluster #${cluster_id} — nothing has been added yet.`,
    };
  },
};

module.exports = {
  CLUSTER_SEARCH_INTENTS,
  TOOLS: [
    checkCannibalizationTool,
    checkTimeSlotTool,
    listClustersTool,
    getClusterTool,
    proposeClusterStatusChange,
    proposeClusterFieldsUpdate,
    proposeUpdateKeywordDate,
    proposeDeleteKeyword,
    proposeDeleteCluster,
    proposeReschedule,
    proposeExpandWithKeywords,
  ],
};
