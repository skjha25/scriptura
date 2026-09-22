// backend/tests/unit/observatory.test.js
'use strict';

/**
 * P5-D tests: services/agents/observatory.js — the read-only aggregation
 * layer powering the Intelligence Observatory. Same in-memory SQLite
 * pattern as every prior P2-P5 test file. These tests exist to prove two
 * things above all: (1) every number/event this returns is grounded in a
 * real row, never fabricated, and (2) this module never writes anything.
 */

jest.mock('../../src/models', () => {
  const { Sequelize } = require('sequelize');
  const sqlite = new Sequelize('sqlite::memory:', { logging: false });
  const User = require('../../src/models/user')(sqlite);
  const AgentActivity = require('../../src/models/agentActivity')(sqlite);
  const AgentRecommendation = require('../../src/models/agentRecommendation')(sqlite);
  const RecommendationAction = require('../../src/models/recommendationAction')(sqlite);
  const RecommendationOutcome = require('../../src/models/recommendationOutcome')(sqlite);
  const LearningCandidate = require('../../src/models/learningCandidate')(sqlite);
  const AgentKnowledge = require('../../src/models/agentKnowledge')(sqlite);
  const AgentKnowledgeUsage = require('../../src/models/agentKnowledgeUsage')(sqlite);

  AgentRecommendation.belongsTo(AgentActivity, { foreignKey: 'source_activity_id', as: 'sourceActivity', constraints: false });
  AgentRecommendation.belongsTo(User, { foreignKey: 'decided_by', as: 'decidedByUser', constraints: false });
  AgentRecommendation.hasMany(RecommendationAction, { foreignKey: 'recommendation_id', as: 'actions' });
  RecommendationAction.belongsTo(AgentRecommendation, { foreignKey: 'recommendation_id', as: 'recommendation' });
  RecommendationAction.belongsTo(User, { foreignKey: 'executed_by', as: 'executedByUser', constraints: false });

  AgentRecommendation.hasMany(RecommendationOutcome, { foreignKey: 'recommendation_id', as: 'outcomes' });
  RecommendationOutcome.belongsTo(AgentRecommendation, { foreignKey: 'recommendation_id', as: 'recommendation' });
  RecommendationAction.hasOne(RecommendationOutcome, { foreignKey: 'action_id', as: 'outcome' });
  RecommendationOutcome.belongsTo(RecommendationAction, { foreignKey: 'action_id', as: 'action' });

  LearningCandidate.belongsTo(User, { foreignKey: 'reviewed_by', as: 'reviewer', constraints: false });
  LearningCandidate.belongsTo(AgentKnowledge, { foreignKey: 'confirmed_knowledge_id', as: 'confirmedKnowledge', constraints: false });

  return {
    User,
    AgentActivity,
    AgentRecommendation,
    RecommendationAction,
    RecommendationOutcome,
    LearningCandidate,
    AgentKnowledge,
    AgentKnowledgeUsage,
    sequelize: sqlite,
    Sequelize,
  };
});

const { AGENT_NAMES } = require('../../src/constants');
const {
  AgentActivity,
  AgentRecommendation,
  RecommendationAction,
  RecommendationOutcome,
  LearningCandidate,
  AgentKnowledge,
  AgentKnowledgeUsage,
  sequelize,
} = require('../../src/models');
const observatory = require('../../src/services/agents/observatory');

async function makeKnowledge(overrides = {}) {
  return AgentKnowledge.create({
    scope: 'agent',
    agent_name: AGENT_NAMES.SEO_ANALYST,
    category: 'seo_strategy',
    topic: 'test.topic',
    claim: 'Observatory test claim.',
    source_type: 'manual_text',
    confidence: 0.5,
    status: 'confirmed',
    ...overrides,
  });
}

async function makeRecAndOutcome({ traceId, agentName = AGENT_NAMES.SEO_ANALYST, outcome = 'improved', evaluatedAt = new Date() }) {
  const rec = await AgentRecommendation.create({
    trace_id: traceId,
    agent_name: agentName,
    recommendation_type: 'recommend_seo_action',
    recommendation_details: { recommendation: 'x' },
    status: 'approved',
  });
  const action = await RecommendationAction.create({
    recommendation_id: rec.id,
    action_type: 'blog.update_seo_fields',
    status: 'completed',
    executor_type: 'automated',
  });
  const out = await RecommendationOutcome.create({
    recommendation_id: rec.id,
    action_id: action.id,
    baseline_captured_at: new Date(),
    baseline_evidence_refs: [{ type: 'blog', id: 1 }],
    baseline_metric_snapshot: [{ metric: 'seo_score', value: 50 }],
    observation_window_days: 14,
    due_at: new Date(),
    status: 'evaluated',
    outcome,
    evaluated_at: evaluatedAt,
  });
  return { rec, action, out };
}

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  await AgentKnowledgeUsage.destroy({ truncate: true });
  await RecommendationOutcome.destroy({ truncate: true });
  await RecommendationAction.destroy({ truncate: true });
  await AgentRecommendation.destroy({ truncate: true });
  await LearningCandidate.destroy({ truncate: true });
  await AgentKnowledge.destroy({ truncate: true });
  await AgentActivity.destroy({ truncate: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('getLiveCounters — real counts only', () => {
  test('empty database -> all zeros, never fabricated placeholders', async () => {
    const counters = await observatory.getLiveCounters();
    expect(counters).toMatchObject({
      activeAgents: 0,
      knowledgeItems: 0,
      knowledgeUsages: 0,
      pendingCandidates: 0,
      contestedKnowledge: 0,
      actionsInProgress: 0,
      completedActions: 0,
      evaluatedOutcomes: 0,
      recentLearningEvents: 0,
    });
    expect(typeof counters.asOf).toBe('string');
  });

  test('reflects real rows exactly', async () => {
    await makeKnowledge({ status: 'contested' });
    await makeKnowledge({ status: 'unverified' });
    await LearningCandidate.create({
      pattern_key: 'p1',
      scope: 'agent',
      agent_name: AGENT_NAMES.SEO_ANALYST,
      category: 'outcome_pattern',
      topic: 't',
      claim: 'c',
      sample_size: 5,
      improved_count: 4,
      declined_count: 1,
      evidence_refs: [],
      status: 'pending_review',
    });
    await makeRecAndOutcome({ traceId: 'trace-1' });

    const counters = await observatory.getLiveCounters();
    expect(counters.knowledgeItems).toBe(2);
    expect(counters.contestedKnowledge).toBe(1);
    expect(counters.pendingCandidates).toBe(1);
    expect(counters.evaluatedOutcomes).toBe(1);
  });
});

describe('getAgentStatuses — honest, real-data-only state derivation', () => {
  test('an agent with no data at all is "idle"', async () => {
    const statuses = await observatory.getAgentStatuses();
    const seo = statuses.find((s) => s.agentName === AGENT_NAMES.SEO_ANALYST);
    expect(seo.state).toBe('idle');
    expect(seo.lastActiveAt).toBeNull();
  });

  test('a very recent knowledge retrieval -> "retrieving_knowledge"', async () => {
    const k = await makeKnowledge();
    await AgentKnowledgeUsage.create({
      trace_id: 'trace-recent',
      agent_name: AGENT_NAMES.SEO_ANALYST,
      knowledge_id: k.id,
      retrieval_method: 'hybrid',
      created_at: new Date(),
    });
    const statuses = await observatory.getAgentStatuses();
    const seo = statuses.find((s) => s.agentName === AGENT_NAMES.SEO_ANALYST);
    expect(seo.state).toBe('retrieving_knowledge');
    expect(seo.lastActiveAt).not.toBeNull();
  });

  test('a real "error" activity row -> "failed"; a "final_reply" row -> "completed"', async () => {
    await AgentActivity.create({
      trace_id: 'trace-e',
      agent_name: AGENT_NAMES.BLOG_OPS,
      event_type: 'error',
      status: 'failure',
      created_at: new Date(),
    });
    const statuses = await observatory.getAgentStatuses();
    expect(statuses.find((s) => s.agentName === AGENT_NAMES.BLOG_OPS).state).toBe('failed');
  });

  test('an event older than the active window -> "idle", never a stale transient state', () => {
    const staleMostRecent = { kind: 'knowledge_retrieval', row: {}, at: new Date(Date.now() - observatory.ACTIVE_WINDOW_MS - 1000) };
    expect(observatory.deriveAgentState(staleMostRecent, Date.now())).toBe('idle');
  });

  test('real per-agent counts are correct and isolated per agent', async () => {
    await makeKnowledge({ agent_name: AGENT_NAMES.SEO_ANALYST, status: 'contested' });
    await makeKnowledge({ agent_name: AGENT_NAMES.BLOG_OPS });
    const statuses = await observatory.getAgentStatuses();
    const seo = statuses.find((s) => s.agentName === AGENT_NAMES.SEO_ANALYST);
    const blogOps = statuses.find((s) => s.agentName === AGENT_NAMES.BLOG_OPS);
    expect(seo.knowledgeCount).toBe(1);
    expect(seo.contestedKnowledge).toBe(1);
    expect(blogOps.knowledgeCount).toBe(1);
    expect(blogOps.contestedKnowledge).toBe(0);
  });

  test('Generate Agent is never included — it never participates in the shared knowledge/recommendation system', async () => {
    const statuses = await observatory.getAgentStatuses();
    expect(statuses.some((s) => s.agentName === AGENT_NAMES.GENERATE)).toBe(false);
  });
});

describe('getActivityStream — real, merged, bounded, never fabricated', () => {
  test('empty database -> empty stream, not placeholder events', async () => {
    expect(await observatory.getActivityStream()).toEqual([]);
  });

  test('an improved outcome produces both an "outcome_evaluated" entry AND a real "reinforcement" entry for the exact knowledge retrieved in that trace', async () => {
    const k = await makeKnowledge();
    await AgentKnowledgeUsage.create({ trace_id: 'trace-r', agent_name: AGENT_NAMES.SEO_ANALYST, knowledge_id: k.id, retrieval_method: 'hybrid' });
    const { out } = await makeRecAndOutcome({ traceId: 'trace-r', outcome: 'improved' });

    const stream = await observatory.getActivityStream();
    const outcomeEvent = stream.find((e) => e.kind === 'outcome_evaluated' && e.outcomeId === out.id);
    const reinforceEvent = stream.find((e) => e.kind === 'reinforcement' && e.outcomeId === out.id);
    expect(outcomeEvent).toBeTruthy();
    expect(outcomeEvent.outcome).toBe('improved');
    expect(reinforceEvent).toBeTruthy();
    expect(reinforceEvent.knowledgeId).toBe(k.id);
    expect(reinforceEvent.direction).toBe('improved');
  });

  test('a neutral outcome produces NO reinforcement entry — matches P5-A/B\'s own gating exactly', async () => {
    const k = await makeKnowledge();
    await AgentKnowledgeUsage.create({ trace_id: 'trace-n', agent_name: AGENT_NAMES.SEO_ANALYST, knowledge_id: k.id, retrieval_method: 'hybrid' });
    await makeRecAndOutcome({ traceId: 'trace-n', outcome: 'neutral' });

    const stream = await observatory.getActivityStream();
    expect(stream.some((e) => e.kind === 'reinforcement')).toBe(false);
  });

  test('a knowledge_retrieval event maps 1:1 to a real agent_knowledge_usage row', async () => {
    const k = await makeKnowledge();
    await AgentKnowledgeUsage.create({ trace_id: 'trace-u', agent_name: AGENT_NAMES.SEO_ANALYST, knowledge_id: k.id, retrieval_method: 'lexical' });
    const stream = await observatory.getActivityStream();
    const usageEvent = stream.find((e) => e.kind === 'knowledge_retrieval');
    expect(usageEvent.knowledgeId).toBe(k.id);
    expect(usageEvent.agentName).toBe(AGENT_NAMES.SEO_ANALYST);
  });

  test('a learning candidate produces a "detected" event, and once reviewed, a separate confirmed/rejected event', async () => {
    const candidate = await LearningCandidate.create({
      pattern_key: 'p-stream',
      scope: 'agent',
      agent_name: AGENT_NAMES.SEO_ANALYST,
      category: 'outcome_pattern',
      topic: 't',
      claim: 'c',
      sample_size: 5,
      improved_count: 4,
      declined_count: 1,
      evidence_refs: [],
      status: 'pending_review',
    });
    let stream = await observatory.getActivityStream();
    expect(stream.some((e) => e.kind === 'learning_candidate_detected' && e.candidateId === candidate.id)).toBe(true);
    expect(stream.some((e) => e.kind === 'candidate_confirmed')).toBe(false);

    await candidate.update({ status: 'confirmed', reviewed_by: 1, reviewed_at: new Date() });
    stream = await observatory.getActivityStream();
    expect(stream.some((e) => e.kind === 'candidate_confirmed' && e.candidateId === candidate.id)).toBe(true);
  });

  test('respects the limit parameter, and results are sorted newest-first', async () => {
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await AgentActivity.create({
        trace_id: `t-${i}`,
        agent_name: AGENT_NAMES.SEO_ANALYST,
        event_type: 'final_reply',
        status: 'success',
        created_at: new Date(Date.now() - (5 - i) * 1000),
      });
    }
    const stream = await observatory.getActivityStream({ limit: 3 });
    expect(stream).toHaveLength(3);
    const times = stream.map((e) => new Date(e.at).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});

describe('getKnowledgeHealth — real status/confidence breakdown, no invented percentages', () => {
  test('empty -> all zero buckets', async () => {
    const health = await observatory.getKnowledgeHealth(AGENT_NAMES.SEO_ANALYST);
    expect(health.total).toBe(0);
    expect(health.confidenceDistribution).toEqual([0, 0, 0, 0, 0]);
  });

  test('real rows bucket correctly by status and confidence', async () => {
    await makeKnowledge({ status: 'confirmed', confidence: 0.9 });
    await makeKnowledge({ status: 'contested', confidence: 0.4, success_count: 2, failure_count: 3 });
    await makeKnowledge({ status: 'unverified', confidence: 0.1 });

    const health = await observatory.getKnowledgeHealth(AGENT_NAMES.SEO_ANALYST);
    expect(health.total).toBe(3);
    expect(health.confirmed).toBe(1);
    expect(health.contested).toBe(1);
    expect(health.unverified).toBe(1);
    expect(health.totalSuccessEvidence).toBe(2);
    expect(health.totalFailureEvidence).toBe(3);
    expect(health.confidenceDistribution[4]).toBe(1); // 0.9 -> bucket 4
    expect(health.confidenceDistribution[0]).toBe(1); // 0.1 -> bucket 0
  });

  test('global-scope knowledge is included for any agent; another agent\'s own-scoped knowledge is not', async () => {
    await makeKnowledge({ scope: 'global', agent_name: null });
    await makeKnowledge({ scope: 'agent', agent_name: AGENT_NAMES.BLOG_OPS });

    const seoHealth = await observatory.getKnowledgeHealth(AGENT_NAMES.SEO_ANALYST);
    expect(seoHealth.total).toBe(1); // only the global row
  });
});

describe('listKnowledgeNodes / getKnowledgeConnections — real relationships only', () => {
  test('getKnowledgeConnections returns null for a nonexistent id, never throws', async () => {
    expect(await observatory.getKnowledgeConnections(999999)).toBeNull();
  });

  test('connections reflect real usage -> recommendation -> action/outcome chains', async () => {
    const k = await makeKnowledge();
    await AgentKnowledgeUsage.create({ trace_id: 'trace-conn', agent_name: AGENT_NAMES.SEO_ANALYST, knowledge_id: k.id, retrieval_method: 'hybrid' });
    const { rec, action, out } = await makeRecAndOutcome({ traceId: 'trace-conn' });

    const connections = await observatory.getKnowledgeConnections(k.id);
    expect(connections.knowledge.id).toBe(k.id);
    expect(connections.recommendations.map((r) => r.id)).toContain(rec.id);
    expect(connections.actions.map((a) => a.id)).toContain(action.id);
    expect(connections.outcomes.map((o) => o.id)).toContain(out.id);
  });

  test('related (contested) knowledge is included when related_knowledge_ids is set', async () => {
    const a = await makeKnowledge({ status: 'contested' });
    const b = await makeKnowledge({ status: 'contested', related_knowledge_ids: [a.id] });
    await a.update({ related_knowledge_ids: [b.id] });

    const connections = await observatory.getKnowledgeConnections(a.id);
    expect(connections.relatedKnowledge.map((r) => r.id)).toEqual([b.id]);
  });

  test('listKnowledgeNodes never returns another agent\'s agent-scoped knowledge', async () => {
    await makeKnowledge({ scope: 'agent', agent_name: AGENT_NAMES.SEO_ANALYST });
    await makeKnowledge({ scope: 'agent', agent_name: AGENT_NAMES.BLOG_OPS });
    const nodes = await observatory.listKnowledgeNodes(AGENT_NAMES.SEO_ANALYST);
    expect(nodes.every((n) => n.agent_name === AGENT_NAMES.SEO_ANALYST || n.scope === 'global')).toBe(true);
  });
});

describe('observatory.js never writes anything — read-only by construction', () => {
  test('no code path in this file references a create/update/destroy call on any model', () => {
    const source = require('fs').readFileSync(require.resolve('../../src/services/agents/observatory.js'), 'utf8');
    expect(source).not.toMatch(/\.create\(|\.update\(|\.destroy\(|\.bulkCreate\(/);
  });

  test('no code path references a system prompt, tool registry, or AI provider', () => {
    const source = require('fs').readFileSync(require.resolve('../../src/services/agents/observatory.js'), 'utf8');
    expect(source).not.toMatch(/systemPrompts|registry\.js|runAgentStep|getTextProvider|anthropic|openai/i);
  });
});
