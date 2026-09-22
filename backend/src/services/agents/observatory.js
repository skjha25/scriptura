'use strict';

/**
 * P5-D: Intelligence Observatory — a READ-ONLY aggregation layer over the
 * existing P0-P5 tables, built to power a live visualization of real agent
 * activity, knowledge retrieval, learning, and reinforcement.
 *
 * This file writes NOTHING, ever. Every function here is a SELECT/GROUP BY
 * over data already produced by the real, unmodified lifecycle
 * (recommendations.js -> recommendationActions.js -> outcomeMeasurement.js
 * -> outcomeEvaluationScheduler.js -> recommendationEvaluation.js ->
 * learningCandidates.js -> learningCandidateDecisions.js ->
 * knowledgeReinforcement.js). No new table, no new column, no new write
 * path, no new scheduler. It exists purely so the frontend has something
 * real to poll and render — every number/event this returns is traceable
 * to an actual persisted row.
 *
 * ---------------------------------------------------------------------------
 * "REINFORCEMENT EVENTS" ARE DERIVED, NOT LOGGED — READ-ONLY, NEVER WRITTEN
 * ---------------------------------------------------------------------------
 * P5-A/B applies reinforcement synchronously inside outcomeEvaluationScheduler.js
 * right after an outcome finalizes, but it writes no separate "reinforcement
 * happened" log row anywhere — only the counters/confidence on the
 * knowledge row itself change. To show a truthful "Knowledge #42 reinforced"
 * timeline entry, `deriveReinforcedKnowledgeIds` below re-runs the EXACT
 * SAME read-only join `knowledgeReinforcement.js#findRetrievedKnowledgeIds`
 * already uses (trace_id + agent_name -> agent_knowledge_usage) against an
 * already-evaluated outcome. This is a read reconstruction of a real,
 * already-applied fact — never a new write, never a guess, never invoked
 * for anything but display.
 *
 * ---------------------------------------------------------------------------
 * DERIVED AGENT "STATE" — HONEST, NOT INVENTED
 * ---------------------------------------------------------------------------
 * `agent_activity.event_type` has no "retrieving_knowledge"/"evaluating_outcome"/
 * "reinforcing_knowledge"/"learning_candidate_detected" values — those never
 * existed as logged event types. `deriveAgentState` computes a state label
 * ONLY from the most recent REAL timestamped row across agent_activity,
 * agent_knowledge_usage, recommendation_outcomes, and learning_candidates
 * for that agent, within a short recency window — never fabricated, never a
 * timer-driven animation. Outside that window, or with no matching row at
 * all, the state is honestly "idle".
 */

const { AGENT_NAMES } = require('../../constants');

/** An agent is ever counted "active" only if it has a real row within this window — a display threshold, never a state transition trigger. */
const ACTIVE_WINDOW_MS = 15 * 60 * 1000;

/** A real event this recent is labeled with its specific transient state (e.g. "retrieving_knowledge"); older-but-still-active real events just read "working". */
const RECENT_EVENT_WINDOW_MS = 30 * 1000;

/** How far back every bounded query below looks — never the full table, regardless of how much history exists. */
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

const STREAM_DEFAULT_LIMIT = 40;
const STREAM_MAX_LIMIT = 100;

const NODE_DEFAULT_LIMIT = 20;
const NODE_MAX_LIMIT = 50;

/** Agent names this observatory covers — Generate Agent is excluded for the same reason sharedKnowledgeTools.js already excludes it: it never participates in the shared knowledge/recommendation system at all. */
const OBSERVED_AGENT_NAMES = Object.values(AGENT_NAMES).filter((name) => name !== AGENT_NAMES.GENERATE);

/** Chat-turn event types worth surfacing in a learning/intelligence stream — user_message/setting_dismissed/chat_cleared are real too, but are UI/session noise for this specific view, not learning-relevant. */
const STREAM_ACTIVITY_EVENT_TYPES = ['tool_call', 'final_reply', 'error', 'delegation', 'setting_applied'];

/** Live counters for the top-of-page counter bar. Every number is a real COUNT()/GROUP BY, no estimate. */
async function getLiveCounters() {
  const { AgentActivity, AgentKnowledge, AgentKnowledgeUsage, LearningCandidate, RecommendationAction, RecommendationOutcome } = require('../../models');
  const { Op, fn, col } = require('sequelize');

  const activeSince = new Date(Date.now() - ACTIVE_WINDOW_MS);
  const recentSince = new Date(Date.now() - LOOKBACK_MS);

  const [
    activeAgentRows,
    knowledgeItems,
    knowledgeUsages,
    pendingCandidates,
    contestedKnowledge,
    actionsInProgress,
    completedActions,
    evaluatedOutcomes,
    recentActivityCount,
    recentUsageCount,
    recentOutcomeCount,
    recentCandidateCount,
  ] = await Promise.all([
    AgentActivity.findAll({
      where: { created_at: { [Op.gte]: activeSince } },
      attributes: [[fn('DISTINCT', col('agent_name')), 'agent_name']],
    }),
    AgentKnowledge.count(),
    AgentKnowledgeUsage.count(),
    LearningCandidate.count({ where: { status: 'pending_review' } }),
    AgentKnowledge.count({ where: { status: 'contested' } }),
    RecommendationAction.count({ where: { status: 'pending' } }),
    RecommendationAction.count({ where: { status: 'completed' } }),
    RecommendationOutcome.count({ where: { status: 'evaluated' } }),
    AgentActivity.count({ where: { created_at: { [Op.gte]: recentSince }, event_type: { [Op.in]: STREAM_ACTIVITY_EVENT_TYPES } } }),
    AgentKnowledgeUsage.count({ where: { created_at: { [Op.gte]: recentSince } } }),
    RecommendationOutcome.count({ where: { status: 'evaluated', evaluated_at: { [Op.gte]: recentSince } } }),
    LearningCandidate.count({ where: { created_at: { [Op.gte]: recentSince } } }),
  ]);

  return {
    activeAgents: activeAgentRows.length,
    knowledgeItems,
    knowledgeUsages,
    pendingCandidates,
    contestedKnowledge,
    actionsInProgress,
    completedActions,
    evaluatedOutcomes,
    // A real, bounded (24h) count of learning-relevant events — the same
    // shape the activity stream itself is built from, not a separate guess.
    recentLearningEvents: recentActivityCount + recentUsageCount + recentOutcomeCount + recentCandidateCount,
    asOf: new Date().toISOString(),
  };
}

/**
 * Honest, real-data-only state label for one agent. `mostRecent` is
 * whichever real timestamped row (across 4 tables) is newest for this
 * agent; `null` when nothing at all exists in the lookback window.
 */
function deriveAgentState(mostRecent, now) {
  if (!mostRecent) return 'idle';
  const ageMs = now - new Date(mostRecent.at).getTime();
  if (ageMs > ACTIVE_WINDOW_MS) return 'idle';

  if (ageMs <= RECENT_EVENT_WINDOW_MS) {
    switch (mostRecent.kind) {
      case 'knowledge_retrieval':
        return 'retrieving_knowledge';
      case 'outcome_evaluated':
        return mostRecent.row.outcome === 'improved' || mostRecent.row.outcome === 'declined' ? 'reinforcing_knowledge' : 'evaluating_outcome';
      case 'learning_candidate_detected':
        return 'learning_candidate_detected';
      case 'activity':
        if (mostRecent.row.event_type === 'error') return 'failed';
        if (mostRecent.row.event_type === 'final_reply') return 'completed';
        return 'working';
      default:
        return 'working';
    }
  }
  return 'working'; // real activity within the active window, just not "this instant"
}

/**
 * One status row per observed agent — state, last-active time, and the
 * real counts a reviewer would want at a glance. Uses a handful of bounded,
 * grouped queries rather than one query per agent.
 */
async function getAgentStatuses() {
  const { AgentActivity, AgentKnowledge, AgentKnowledgeUsage, LearningCandidate, AgentRecommendation, RecommendationOutcome } = require('../../models');
  const { Op, fn, col } = require('sequelize');

  const since = new Date(Date.now() - LOOKBACK_MS);

  const [recentActivity, recentUsage, recentCandidates, recentOutcomes, knowledgeCounts, contestedCounts, pendingCounts] = await Promise.all([
    AgentActivity.findAll({ where: { created_at: { [Op.gte]: since } }, order: [['created_at', 'DESC']], limit: 500 }),
    AgentKnowledgeUsage.findAll({ where: { created_at: { [Op.gte]: since } }, order: [['created_at', 'DESC']], limit: 500 }),
    LearningCandidate.findAll({ where: { created_at: { [Op.gte]: since } }, order: [['created_at', 'DESC']], limit: 200 }),
    RecommendationOutcome.findAll({
      where: { status: 'evaluated', evaluated_at: { [Op.gte]: since } },
      include: [{ model: AgentRecommendation, as: 'recommendation', attributes: ['agent_name'] }],
      order: [['evaluated_at', 'DESC']],
      limit: 200,
    }),
    AgentKnowledge.findAll({ where: { scope: 'agent' }, attributes: ['agent_name', [fn('COUNT', col('id')), 'count']], group: ['agent_name'] }),
    AgentKnowledge.findAll({
      where: { scope: 'agent', status: 'contested' },
      attributes: ['agent_name', [fn('COUNT', col('id')), 'count']],
      group: ['agent_name'],
    }),
    LearningCandidate.findAll({
      where: { status: 'pending_review' },
      attributes: ['agent_name', [fn('COUNT', col('id')), 'count']],
      group: ['agent_name'],
    }),
  ]);

  const firstByAgent = (rows, agentKey = 'agent_name') => {
    const map = new Map();
    for (const row of rows) {
      const key = row[agentKey];
      if (key && !map.has(key)) map.set(key, row);
    }
    return map;
  };
  const lastActivityByAgent = firstByAgent(recentActivity);
  const lastUsageByAgent = firstByAgent(recentUsage);
  const lastCandidateByAgent = firstByAgent(recentCandidates);

  const lastOutcomeByAgent = new Map();
  const recentOutcomeCountByAgent = new Map();
  for (const row of recentOutcomes) {
    const agentName = row.recommendation?.agent_name;
    if (!agentName) continue;
    if (!lastOutcomeByAgent.has(agentName)) lastOutcomeByAgent.set(agentName, row);
    recentOutcomeCountByAgent.set(agentName, (recentOutcomeCountByAgent.get(agentName) || 0) + 1);
  }

  const countMap = (rows) => new Map(rows.map((r) => [r.agent_name, Number(r.get('count'))]));
  const knowledgeCountByAgent = countMap(knowledgeCounts);
  const contestedCountByAgent = countMap(contestedCounts);
  const pendingCountByAgent = countMap(pendingCounts);

  const now = Date.now();
  return OBSERVED_AGENT_NAMES.map((agentName) => {
    const candidates = [
      lastActivityByAgent.get(agentName) && { kind: 'activity', row: lastActivityByAgent.get(agentName), at: lastActivityByAgent.get(agentName).created_at },
      lastUsageByAgent.get(agentName) && { kind: 'knowledge_retrieval', row: lastUsageByAgent.get(agentName), at: lastUsageByAgent.get(agentName).created_at },
      lastCandidateByAgent.get(agentName) && {
        kind: 'learning_candidate_detected',
        row: lastCandidateByAgent.get(agentName),
        at: lastCandidateByAgent.get(agentName).created_at,
      },
      lastOutcomeByAgent.get(agentName) && { kind: 'outcome_evaluated', row: lastOutcomeByAgent.get(agentName), at: lastOutcomeByAgent.get(agentName).evaluated_at },
    ].filter(Boolean);
    candidates.sort((a, b) => new Date(b.at) - new Date(a.at));
    const mostRecent = candidates[0] || null;

    return {
      agentName,
      state: deriveAgentState(mostRecent, now),
      lastActiveAt: mostRecent ? mostRecent.at : null,
      knowledgeCount: knowledgeCountByAgent.get(agentName) || 0,
      pendingCandidates: pendingCountByAgent.get(agentName) || 0,
      contestedKnowledge: contestedCountByAgent.get(agentName) || 0,
      recentOutcomes: recentOutcomeCountByAgent.get(agentName) || 0,
    };
  });
}

/** Short, human line for one agent_activity row — same spirit as AgentActivityPage.js's own `summarize`, kept backend-side so any future consumer gets the same text. */
function describeActivityEvent(row) {
  const payload = row.payload || {};
  switch (row.event_type) {
    case 'tool_call':
      return `used tool ${row.tool_name || 'a tool'}`;
    case 'final_reply':
      return 'completed a turn';
    case 'error':
      return payload.error_message || 'an error occurred';
    case 'delegation':
      return `delegated to ${row.to_agent || 'another agent'}`;
    case 'setting_applied':
      return `applied a setting change${row.setting_key ? ` (${row.setting_key})` : ''}`;
    default:
      return row.event_type;
  }
}

/**
 * Read-only reconstruction of which knowledge ids ONE already-evaluated
 * outcome reinforced — mirrors knowledgeReinforcement.js#findRetrievedKnowledgeIds
 * exactly. See this file's header comment. Never writes anything.
 */
async function deriveReinforcedKnowledgeIds(outcomeRow) {
  if (outcomeRow.outcome !== 'improved' && outcomeRow.outcome !== 'declined') return [];
  const { AgentRecommendation, AgentKnowledgeUsage } = require('../../models');
  const recommendation = await AgentRecommendation.findByPk(outcomeRow.recommendation_id, { attributes: ['trace_id', 'agent_name'] });
  if (!recommendation?.trace_id) return [];
  const usageRows = await AgentKnowledgeUsage.findAll({
    where: { trace_id: recommendation.trace_id, agent_name: recommendation.agent_name },
    attributes: ['knowledge_id'],
  });
  return Array.from(new Set(usageRows.map((r) => r.knowledge_id)));
}

/**
 * A real, time-merged activity stream — bounded by `limit` and a 24h
 * lookback, never the full history. Every entry maps 1:1 to a real row (or,
 * for `reinforcement` entries, a deterministic read-only reconstruction of
 * one — see the header comment).
 */
async function getActivityStream({ limit = STREAM_DEFAULT_LIMIT } = {}) {
  const boundedLimit = Math.min(Math.max(1, Number(limit) || STREAM_DEFAULT_LIMIT), STREAM_MAX_LIMIT);
  const { AgentActivity, AgentKnowledgeUsage, RecommendationOutcome, LearningCandidate } = require('../../models');
  const { Op } = require('sequelize');
  const since = new Date(Date.now() - LOOKBACK_MS);

  const [activityRows, usageRows, outcomeRows, candidateRows] = await Promise.all([
    AgentActivity.findAll({
      where: { created_at: { [Op.gte]: since }, event_type: { [Op.in]: STREAM_ACTIVITY_EVENT_TYPES } },
      order: [['created_at', 'DESC']],
      limit: boundedLimit * 2,
    }),
    AgentKnowledgeUsage.findAll({ where: { created_at: { [Op.gte]: since } }, order: [['created_at', 'DESC']], limit: boundedLimit * 2 }),
    RecommendationOutcome.findAll({ where: { status: 'evaluated', evaluated_at: { [Op.gte]: since } }, order: [['evaluated_at', 'DESC']], limit: boundedLimit }),
    LearningCandidate.findAll({ where: { created_at: { [Op.gte]: since } }, order: [['created_at', 'DESC']], limit: boundedLimit }),
  ]);

  const events = [];

  for (const row of activityRows) {
    events.push({
      id: `activity-${row.id}`,
      at: row.created_at,
      kind: 'activity',
      eventType: row.event_type,
      agentName: row.agent_name,
      icon: row.event_type === 'error' ? '⚠️' : row.event_type === 'final_reply' ? '💬' : row.event_type === 'delegation' ? '🔀' : '🛠️',
      summary: describeActivityEvent(row),
    });
  }

  for (const row of usageRows) {
    events.push({
      id: `usage-${row.id}`,
      at: row.created_at,
      kind: 'knowledge_retrieval',
      agentName: row.agent_name,
      knowledgeId: row.knowledge_id,
      icon: '🧠',
      summary: `retrieved Knowledge #${row.knowledge_id}`,
    });
  }

  for (const row of outcomeRows) {
    events.push({
      id: `outcome-${row.id}`,
      at: row.evaluated_at,
      kind: 'outcome_evaluated',
      outcomeId: row.id,
      outcome: row.outcome,
      icon: '📊',
      summary: `Outcome #${row.id} evaluated as ${row.outcome}`,
    });

    // eslint-disable-next-line no-await-in-loop -- bounded by boundedLimit; read-only observation, admin-scale
    const reinforcedIds = await deriveReinforcedKnowledgeIds(row);
    for (const knowledgeId of reinforcedIds) {
      events.push({
        id: `reinforce-${row.id}-${knowledgeId}`,
        at: row.evaluated_at,
        kind: 'reinforcement',
        outcomeId: row.id,
        knowledgeId,
        direction: row.outcome,
        icon: '🔄',
        summary: `Knowledge #${knowledgeId} reinforced (${row.outcome})`,
      });
    }
  }

  for (const row of candidateRows) {
    events.push({
      id: `candidate-detected-${row.id}`,
      at: row.created_at,
      kind: 'learning_candidate_detected',
      candidateId: row.id,
      agentName: row.agent_name,
      icon: '🧠',
      summary: `Learning candidate detected for "${row.topic}"`,
    });
    if (row.reviewed_at && row.status !== 'pending_review') {
      events.push({
        id: `candidate-reviewed-${row.id}`,
        at: row.reviewed_at,
        kind: row.status === 'confirmed' ? 'candidate_confirmed' : 'candidate_rejected',
        candidateId: row.id,
        agentName: row.agent_name,
        icon: row.status === 'confirmed' ? '✅' : '❌',
        summary: `Learning candidate ${row.status === 'confirmed' ? 'confirmed' : 'rejected'} for "${row.topic}"`,
      });
    }
  }

  events.sort((a, b) => new Date(b.at) - new Date(a.at));
  return events.slice(0, boundedLimit);
}

/** Real per-agent (or platform-wide, when agentName omitted) knowledge health — status breakdown, confidence distribution, and accumulated success/failure evidence. Zero invented percentages — every bucket is a real row count. */
async function getKnowledgeHealth(agentName) {
  const { AgentKnowledge, LearningCandidate } = require('../../models');
  const { Op } = require('sequelize');

  const where = agentName ? { [Op.or]: [{ scope: 'global' }, { scope: 'agent', agent_name: agentName }] } : {};
  const rows = await AgentKnowledge.findAll({ where, attributes: ['id', 'status', 'confidence', 'success_count', 'failure_count'] });

  const byStatus = {};
  const confidenceDistribution = [0, 0, 0, 0, 0]; // buckets: [0-.2) [.2-.4) [.4-.6) [.6-.8) [.8-1.0]
  let totalSuccessEvidence = 0;
  let totalFailureEvidence = 0;
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    const bucket = Math.min(4, Math.max(0, Math.floor((typeof row.confidence === 'number' ? row.confidence : 0.5) * 5)));
    confidenceDistribution[bucket] += 1;
    totalSuccessEvidence += row.success_count || 0;
    totalFailureEvidence += row.failure_count || 0;
  }

  const pendingCandidates = await LearningCandidate.count({
    where: { status: 'pending_review', ...(agentName ? { agent_name: agentName } : {}) },
  });

  return {
    total: rows.length,
    confirmed: (byStatus.confirmed || 0) + (byStatus.supported || 0),
    unverified: byStatus.unverified || 0,
    contested: byStatus.contested || 0,
    outdated: byStatus.outdated || 0,
    pendingCandidates,
    confidenceDistribution,
    totalSuccessEvidence,
    totalFailureEvidence,
  };
}

/** A bounded, rankable list of knowledge nodes for one agent (global + its own), most-used first — the entry points for the Knowledge Network view. */
async function listKnowledgeNodes(agentName, { limit = NODE_DEFAULT_LIMIT } = {}) {
  const { AgentKnowledge } = require('../../models');
  const { Op } = require('sequelize');
  const boundedLimit = Math.min(Math.max(1, Number(limit) || NODE_DEFAULT_LIMIT), NODE_MAX_LIMIT);

  const where = agentName ? { [Op.or]: [{ scope: 'global' }, { scope: 'agent', agent_name: agentName }] } : {};
  return AgentKnowledge.findAll({
    where,
    order: [
      ['usage_count', 'DESC'],
      ['created_at', 'DESC'],
    ],
    limit: boundedLimit,
    attributes: ['id', 'topic', 'category', 'claim', 'scope', 'agent_name', 'status', 'confidence', 'usage_count', 'success_count', 'failure_count', 'related_knowledge_ids'],
  });
}

/**
 * Real relationship edges for ONE knowledge node — every recommendation
 * that ever retrieved it (via the same trace_id join P5-A/B uses), those
 * recommendations' actions/outcomes, and any related (contested) knowledge.
 * Bounded to recent/limited rows — never the full history for a
 * long-lived, heavily-used row.
 */
async function getKnowledgeConnections(knowledgeId) {
  const { AgentKnowledge, AgentKnowledgeUsage, AgentRecommendation, RecommendationAction, RecommendationOutcome } = require('../../models');
  const { Op } = require('sequelize');

  const knowledge = await AgentKnowledge.findByPk(knowledgeId);
  if (!knowledge) return null;

  const usageRows = await AgentKnowledgeUsage.findAll({
    where: { knowledge_id: knowledgeId },
    order: [['created_at', 'DESC']],
    limit: 20,
  });
  const traceIds = Array.from(new Set(usageRows.map((r) => r.trace_id)));

  const recommendations = traceIds.length
    ? await AgentRecommendation.findAll({ where: { trace_id: { [Op.in]: traceIds } }, order: [['created_at', 'DESC']], limit: 20 })
    : [];
  const recommendationIds = recommendations.map((r) => r.id);

  const [actions, outcomes, relatedKnowledge] = await Promise.all([
    recommendationIds.length
      ? RecommendationAction.findAll({ where: { recommendation_id: { [Op.in]: recommendationIds } }, limit: 40 })
      : [],
    recommendationIds.length
      ? RecommendationOutcome.findAll({ where: { recommendation_id: { [Op.in]: recommendationIds } }, limit: 40 })
      : [],
    Array.isArray(knowledge.related_knowledge_ids) && knowledge.related_knowledge_ids.length
      ? AgentKnowledge.findAll({ where: { id: { [Op.in]: knowledge.related_knowledge_ids } } })
      : [],
  ]);

  return {
    knowledge,
    recommendations,
    actions,
    outcomes,
    relatedKnowledge,
    recentUsageCount: usageRows.length,
  };
}

module.exports = {
  getLiveCounters,
  getAgentStatuses,
  getActivityStream,
  getKnowledgeHealth,
  listKnowledgeNodes,
  getKnowledgeConnections,
  deriveAgentState,
  deriveReinforcedKnowledgeIds,
  OBSERVED_AGENT_NAMES,
  ACTIVE_WINDOW_MS,
  RECENT_EVENT_WINDOW_MS,
};
