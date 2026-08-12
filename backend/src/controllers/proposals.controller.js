'use strict';

/**
 * POST /agents/proposals/apply — the entity-mutation counterpart to
 * controllers/agents.controller.js's `applySetting`.
 *
 * Same safety invariant: no agent tool ever calls a model/table-write
 * function itself, it only returns a proposal; this handler is the ONE place
 * that actually persists an entity-mutation proposal, after independent
 * re-validation (validators/proposals.validators.js) — and it dispatches into
 * the same service functions the human-facing REST controllers use, so there
 * is exactly one write path per table regardless of who triggered it.
 */

const crypto = require('crypto');

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { AGENT_NAMES } = require('../constants');
const agentActivityLogger = require('../services/agentActivityLogger');

/** action -> which agent's audit trail this belongs to. */
const AGENT_FOR_ACTION = {
  'topics.create_topics': AGENT_NAMES.RESEARCH,
  'keyword_pool.create_keywords': AGENT_NAMES.RESEARCH,
  'cluster.update_status': AGENT_NAMES.CLUSTER,
  'cluster.update_fields': AGENT_NAMES.CLUSTER,
  'cluster.update_keyword_date': AGENT_NAMES.CLUSTER,
  'cluster.delete_keyword': AGENT_NAMES.CLUSTER,
  'cluster.delete_cluster': AGENT_NAMES.CLUSTER,
  'cluster.reschedule': AGENT_NAMES.CLUSTER,
  'cluster.expand': AGENT_NAMES.CLUSTER,
};

/**
 * `topics.create_topics` — dedupes against existing rows the same way the
 * human-facing `POST /settings/topics` (`addTopic`) does, rather than letting
 * `bulkCreate` throw on the unique `topic` constraint for any collision.
 */
async function applyCreateTopics({ topics }) {
  const { AutomatedTopic } = require('../models');
  const created = [];
  const skipped = [];

  for (const raw of topics) {
    const topic = raw.trim();
    // eslint-disable-next-line no-await-in-loop -- each topic's existence check must land before the next.
    const existing = await AutomatedTopic.findOne({ where: { topic } });
    if (existing) {
      skipped.push(topic);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const row = await AutomatedTopic.create({ topic });
    created.push({ id: Number(row.id), topic: row.topic });
  }

  return { created, skipped };
}

/**
 * `keyword_pool.create_keywords` — dedupes against existing rows
 * case-insensitively. The human-facing `POST /keywords` endpoint doesn't
 * dedup at all (no unique constraint on `primary_keyword`), but an agent
 * proposing several keywords at once should not silently create literal
 * duplicates of what's already in the pool.
 */
async function applyCreateKeywords({ keywords }) {
  const { ScripturaKeyword } = require('../models');

  const existingRows = await ScripturaKeyword.findAll({ attributes: ['primary_keyword'] });
  const existingLower = new Set(existingRows.map((r) => r.primary_keyword.trim().toLowerCase()));

  const created = [];
  const skipped = [];

  for (const kw of keywords) {
    const primary = kw.primary_keyword.trim();
    if (existingLower.has(primary.toLowerCase())) {
      skipped.push(primary);
      continue;
    }
    existingLower.add(primary.toLowerCase()); // guard against dupes within the same proposal
    // eslint-disable-next-line no-await-in-loop -- each row's dedupe state must land before the next check.
    const row = await ScripturaKeyword.create({
      primary_keyword: primary,
      secondary_keywords: kw.secondary_keywords || [],
      search_intent: kw.search_intent || 'informational',
      status: 'not_used',
    });
    created.push({ id: row.id, primary_keyword: row.primary_keyword });
  }

  return { created, skipped };
}

const applyProposal = asyncHandler(async (req, res) => {
  const { action } = req.body;
  const traceId = req.body.trace_id || crypto.randomUUID();
  const agentName = AGENT_FOR_ACTION[action];
  const clusterService = require('../services/clusterService');

  let result;
  switch (action) {
    case 'topics.create_topics':
      result = await applyCreateTopics(req.body);
      break;
    case 'keyword_pool.create_keywords':
      result = await applyCreateKeywords(req.body);
      break;
    case 'cluster.update_status':
      result = await clusterService.updateCluster(req.body.cluster_id, { status: req.body.status });
      break;
    case 'cluster.update_fields': {
      // eslint-disable-next-line no-unused-vars -- destructured only to drop these from `fields`
      const { action: _a, cluster_id, trace_id: _t, ...fields } = req.body;
      result = await clusterService.updateCluster(cluster_id, fields);
      break;
    }
    case 'cluster.update_keyword_date':
      result = await clusterService.updateKeyword(req.body.cluster_id, req.body.keyword_id, {
        scheduled_generation_date: req.body.scheduled_generation_date,
      });
      break;
    case 'cluster.delete_keyword':
      result = await clusterService.removeKeyword(req.body.cluster_id, req.body.keyword_id);
      break;
    case 'cluster.delete_cluster':
      result = await clusterService.deleteCluster(req.body.cluster_id);
      break;
    case 'cluster.reschedule':
      result = await clusterService.scheduleAll(req.body.cluster_id, req.body.schedule);
      break;
    case 'cluster.expand':
      result = { keywords: await clusterService.createExpandKeywords(req.body.cluster_id, req.body.keywords) };
      break;
    default:
      // Unreachable given the discriminated-union validator; defensive guard
      // in case an action is added to the enum without a branch here.
      throw ApiError.badRequest(`Unsupported proposal action "${action}".`);
  }

  await agentActivityLogger.settingApplied({
    traceId,
    agentName,
    settingKey: action,
    previousValue: null,
    newValue: result,
    userId: req.user.id,
  });

  res.json({ data: result });
});

module.exports = {
  applyProposal,
};
