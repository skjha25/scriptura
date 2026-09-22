// backend/tests/unit/knowledgeReinforcement.test.js
'use strict';

/**
 * P5-A/B tests: services/agents/knowledge/knowledgeReinforcement.js and
 * knowledgeStore.js#reinforceKnowledge — the retrieval-only confidence
 * reinforcement mechanism. Same in-memory SQLite pattern as every prior
 * P2-P4 test file. These tests exercise the mechanism directly (not through
 * the scheduler) so the confidence formula's edge cases can be pinned down
 * precisely; outcomeEvaluationScheduler.test.js covers the wired-in,
 * end-to-end/idempotency behavior.
 */

jest.mock('../../src/models', () => {
  const { Sequelize } = require('sequelize');
  const sqlite = new Sequelize('sqlite::memory:', { logging: false });
  const AgentKnowledge = require('../../src/models/agentKnowledge')(sqlite);
  const AgentKnowledgeUsage = require('../../src/models/agentKnowledgeUsage')(sqlite);

  return {
    AgentKnowledge,
    AgentKnowledgeUsage,
    sequelize: sqlite,
    Sequelize,
  };
});

const { AGENT_NAMES } = require('../../src/constants');
const { AgentKnowledge, AgentKnowledgeUsage, sequelize } = require('../../src/models');
const {
  applyOutcomeReinforcement,
  findRetrievedKnowledgeIds,
  MIN_REINFORCEMENT_SAMPLES,
  POSITIVE_DELTA,
  NEGATIVE_DELTA,
  MIN_CONFIDENCE,
  MAX_CONFIDENCE,
} = require('../../src/services/agents/knowledge/knowledgeReinforcement');
const knowledgeStore = require('../../src/services/agents/knowledge/knowledgeStore');

async function makeKnowledge(overrides = {}) {
  return AgentKnowledge.create({
    scope: 'agent',
    agent_name: AGENT_NAMES.SEO_ANALYST,
    category: 'seo_strategy',
    topic: 'meta_title_length',
    claim: 'Shorter meta titles perform better for this pattern.',
    evidence: 'Observed across several outcomes.',
    source_type: 'manual_text',
    confidence: 0.5,
    status: 'confirmed',
    ...overrides,
  });
}

async function makeUsage({ traceId, agentName = AGENT_NAMES.SEO_ANALYST, knowledgeId }) {
  return AgentKnowledgeUsage.create({
    trace_id: traceId,
    agent_name: agentName,
    knowledge_id: knowledgeId,
    relevance_score: 0.8,
    retrieval_method: 'hybrid',
  });
}

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  await AgentKnowledgeUsage.destroy({ truncate: true });
  await AgentKnowledge.destroy({ truncate: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('constants this suite relies on', () => {
  test('exact documented policy', () => {
    expect(MIN_REINFORCEMENT_SAMPLES).toBe(3);
    expect(POSITIVE_DELTA).toBe(0.03);
    expect(NEGATIVE_DELTA).toBe(0.03);
    expect(MIN_CONFIDENCE).toBe(0);
    expect(MAX_CONFIDENCE).toBe(0.95);
  });
});

describe('findRetrievedKnowledgeIds — the trace_id + agent_name join', () => {
  test('returns exactly the knowledge ids retrieved for this trace + agent, deduped', async () => {
    const k1 = await makeKnowledge({ topic: 'a' });
    const k2 = await makeKnowledge({ topic: 'b' });
    await makeUsage({ traceId: 'trace-1', knowledgeId: k1.id });
    await makeUsage({ traceId: 'trace-1', knowledgeId: k2.id });
    await makeUsage({ traceId: 'trace-1', knowledgeId: k1.id }); // re-retrieved in a later turn of the same trace

    const ids = await findRetrievedKnowledgeIds({ trace_id: 'trace-1', agent_name: AGENT_NAMES.SEO_ANALYST });
    expect(ids.sort()).toEqual([k1.id, k2.id].sort());
  });

  test('never returns a DIFFERENT agent\'s usage rows, even for the same trace_id (shared delegation-chain trace)', async () => {
    const k1 = await makeKnowledge({ agent_name: AGENT_NAMES.SEO_ANALYST });
    const k2 = await makeKnowledge({ agent_name: AGENT_NAMES.BLOG_OPS });
    await makeUsage({ traceId: 'shared-trace', agentName: AGENT_NAMES.SEO_ANALYST, knowledgeId: k1.id });
    await makeUsage({ traceId: 'shared-trace', agentName: AGENT_NAMES.BLOG_OPS, knowledgeId: k2.id });

    const ids = await findRetrievedKnowledgeIds({ trace_id: 'shared-trace', agent_name: AGENT_NAMES.SEO_ANALYST });
    expect(ids).toEqual([k1.id]);
  });

  test('a different trace_id never contributes ids ("unrelated knowledge rows remain unchanged")', async () => {
    const k1 = await makeKnowledge();
    await makeUsage({ traceId: 'other-trace', knowledgeId: k1.id });

    const ids = await findRetrievedKnowledgeIds({ trace_id: 'this-trace', agent_name: AGENT_NAMES.SEO_ANALYST });
    expect(ids).toEqual([]);
  });

  test('missing trace_id/agent_name -> empty, never throws', async () => {
    expect(await findRetrievedKnowledgeIds({})).toEqual([]);
    expect(await findRetrievedKnowledgeIds(null)).toEqual([]);
  });
});

describe('applyOutcomeReinforcement — classification gating', () => {
  test('neutral changes neither counter nor confidence', async () => {
    const k1 = await makeKnowledge({ confidence: 0.5 });
    await makeUsage({ traceId: 'trace-n', knowledgeId: k1.id });

    const { reinforcedIds } = await applyOutcomeReinforcement({ trace_id: 'trace-n', agent_name: AGENT_NAMES.SEO_ANALYST }, 'neutral');

    expect(reinforcedIds).toEqual([]);
    const reloaded = await AgentKnowledge.findByPk(k1.id);
    expect(reloaded.success_count).toBe(0);
    expect(reloaded.failure_count).toBe(0);
    expect(reloaded.confidence).toBe(0.5);
  });

  test('inconclusive changes neither counter nor confidence', async () => {
    const k1 = await makeKnowledge({ confidence: 0.5 });
    await makeUsage({ traceId: 'trace-i', knowledgeId: k1.id });

    const { reinforcedIds } = await applyOutcomeReinforcement({ trace_id: 'trace-i', agent_name: AGENT_NAMES.SEO_ANALYST }, 'inconclusive');

    expect(reinforcedIds).toEqual([]);
    const reloaded = await AgentKnowledge.findByPk(k1.id);
    expect(reloaded.success_count).toBe(0);
    expect(reloaded.failure_count).toBe(0);
    expect(reloaded.confidence).toBe(0.5);
  });

  test('improved increments success_count on exactly the retrieved rows, not confidence yet (below MIN_REINFORCEMENT_SAMPLES)', async () => {
    const retrieved = await makeKnowledge({ confidence: 0.5 });
    const unrelated = await makeKnowledge({ topic: 'unrelated', confidence: 0.5 });
    await makeUsage({ traceId: 'trace-improve', knowledgeId: retrieved.id });

    const { reinforcedIds } = await applyOutcomeReinforcement({ trace_id: 'trace-improve', agent_name: AGENT_NAMES.SEO_ANALYST }, 'improved');

    expect(reinforcedIds).toEqual([retrieved.id]);
    const reloadedRetrieved = await AgentKnowledge.findByPk(retrieved.id);
    expect(reloadedRetrieved.success_count).toBe(1);
    expect(reloadedRetrieved.failure_count).toBe(0);
    expect(reloadedRetrieved.confidence).toBe(0.5); // single outcome: below threshold, confidence untouched

    const reloadedUnrelated = await AgentKnowledge.findByPk(unrelated.id);
    expect(reloadedUnrelated.success_count).toBe(0);
    expect(reloadedUnrelated.usage_count).toBe(0);
  });

  test('declined increments failure_count on exactly the retrieved rows', async () => {
    const retrieved = await makeKnowledge({ confidence: 0.5 });
    await makeUsage({ traceId: 'trace-decline', knowledgeId: retrieved.id });

    await applyOutcomeReinforcement({ trace_id: 'trace-decline', agent_name: AGENT_NAMES.SEO_ANALYST }, 'declined');

    const reloaded = await AgentKnowledge.findByPk(retrieved.id);
    expect(reloaded.success_count).toBe(0);
    expect(reloaded.failure_count).toBe(1);
    expect(reloaded.confidence).toBe(0.5);
  });

  test('usage_count is never touched by reinforcement — it is a retrieval-time signal, not a validation-time one', async () => {
    const retrieved = await makeKnowledge({ confidence: 0.5, usage_count: 4 });
    await makeUsage({ traceId: 'trace-usage', knowledgeId: retrieved.id });

    await applyOutcomeReinforcement({ trace_id: 'trace-usage', agent_name: AGENT_NAMES.SEO_ANALYST }, 'improved');

    const reloaded = await AgentKnowledge.findByPk(retrieved.id);
    expect(reloaded.usage_count).toBe(4); // untouched
  });

  test('scope, agent_name, claim, evidence, category, topic, status, knowledge_type, related_knowledge_ids, version, supersedes_id are never touched', async () => {
    const retrieved = await makeKnowledge({
      scope: 'agent',
      agent_name: AGENT_NAMES.SEO_ANALYST,
      claim: 'original claim',
      evidence: 'original evidence',
      category: 'seo_strategy',
      topic: 'original_topic',
      status: 'confirmed',
      knowledge_type: 'strategy',
      version: 1,
      confidence: 0.5,
    });
    await makeUsage({ traceId: 'trace-fields', knowledgeId: retrieved.id });

    await applyOutcomeReinforcement({ trace_id: 'trace-fields', agent_name: AGENT_NAMES.SEO_ANALYST }, 'improved');

    const reloaded = await AgentKnowledge.findByPk(retrieved.id);
    expect(reloaded.scope).toBe('agent');
    expect(reloaded.agent_name).toBe(AGENT_NAMES.SEO_ANALYST);
    expect(reloaded.claim).toBe('original claim');
    expect(reloaded.evidence).toBe('original evidence');
    expect(reloaded.category).toBe('seo_strategy');
    expect(reloaded.topic).toBe('original_topic');
    expect(reloaded.status).toBe('confirmed');
    expect(reloaded.knowledge_type).toBe('strategy');
    expect(reloaded.version).toBe(1);
    expect(reloaded.supersedes_id).toBeNull();
    expect(reloaded.related_knowledge_ids).toBeNull();
  });

  test('reinforcement never creates or deletes any agent_knowledge row', async () => {
    const retrieved = await makeKnowledge();
    await makeUsage({ traceId: 'trace-nocreate', knowledgeId: retrieved.id });
    const before = await AgentKnowledge.count();

    await applyOutcomeReinforcement({ trace_id: 'trace-nocreate', agent_name: AGENT_NAMES.SEO_ANALYST }, 'improved');
    await applyOutcomeReinforcement({ trace_id: 'trace-nocreate', agent_name: AGENT_NAMES.SEO_ANALYST }, 'declined');

    expect(await AgentKnowledge.count()).toBe(before);
  });
});

describe('confidence formula — thresholded, bounded, symmetric', () => {
  test('a single outcome NEVER materially changes confidence (0 change until the 3rd qualifying observation)', async () => {
    const k = await makeKnowledge({ confidence: 0.5 });
    await makeUsage({ traceId: 't1', knowledgeId: k.id });
    await applyOutcomeReinforcement({ trace_id: 't1', agent_name: AGENT_NAMES.SEO_ANALYST }, 'improved');
    expect((await AgentKnowledge.findByPk(k.id)).confidence).toBe(0.5);

    await makeUsage({ traceId: 't2', knowledgeId: k.id });
    await applyOutcomeReinforcement({ trace_id: 't2', agent_name: AGENT_NAMES.SEO_ANALYST }, 'improved');
    const afterTwo = await AgentKnowledge.findByPk(k.id);
    expect(afterTwo.success_count).toBe(2);
    expect(afterTwo.confidence).toBe(0.5); // still untouched — 2 < MIN_REINFORCEMENT_SAMPLES (3)
  });

  test('the 3rd qualifying observation applies exactly one bounded +0.03 delta', async () => {
    const k = await makeKnowledge({ confidence: 0.5 });
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await makeUsage({ traceId: `trace-${i}`, knowledgeId: k.id });
      // eslint-disable-next-line no-await-in-loop
      await applyOutcomeReinforcement({ trace_id: `trace-${i}`, agent_name: AGENT_NAMES.SEO_ANALYST }, 'improved');
    }
    const reloaded = await AgentKnowledge.findByPk(k.id);
    expect(reloaded.success_count).toBe(3);
    expect(reloaded.confidence).toBeCloseTo(0.53, 5); // 0.5 + 0.03, once, on crossing the threshold
  });

  test('symmetric: an alternating success/failure stream nets to no sustained directional drift', async () => {
    const k = await makeKnowledge({ confidence: 0.5 });
    const sequence = ['improved', 'declined', 'improved', 'declined', 'improved', 'declined'];
    for (let i = 0; i < sequence.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await makeUsage({ traceId: `alt-${i}`, knowledgeId: k.id });
      // eslint-disable-next-line no-await-in-loop
      await applyOutcomeReinforcement({ trace_id: `alt-${i}`, agent_name: AGENT_NAMES.SEO_ANALYST }, sequence[i]);
    }
    const reloaded = await AgentKnowledge.findByPk(k.id);
    expect(reloaded.success_count).toBe(3);
    expect(reloaded.failure_count).toBe(3);
    // 6 total qualifying observations, threshold crossed at #3 (a success) then
    // every subsequent event alternates the delta sign — net drift stays within
    // one delta's worth of the starting point, never trending away.
    expect(Math.abs(reloaded.confidence - 0.5)).toBeLessThanOrEqual(POSITIVE_DELTA + 1e-9);
  });

  test('repeated positive evidence moves confidence up gradually, never in one jump, and never above MAX_CONFIDENCE', async () => {
    const k = await makeKnowledge({ confidence: 0.9 });
    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await makeUsage({ traceId: `pos-${i}`, knowledgeId: k.id });
      // eslint-disable-next-line no-await-in-loop
      await applyOutcomeReinforcement({ trace_id: `pos-${i}`, agent_name: AGENT_NAMES.SEO_ANALYST }, 'improved');
    }
    const reloaded = await AgentKnowledge.findByPk(k.id);
    expect(reloaded.confidence).toBeLessThanOrEqual(MAX_CONFIDENCE);
    expect(reloaded.confidence).toBe(MAX_CONFIDENCE); // clamped, not overshot
  });

  test('repeated negative evidence moves confidence down gradually, never below MIN_CONFIDENCE', async () => {
    const k = await makeKnowledge({ confidence: 0.1 });
    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await makeUsage({ traceId: `neg-${i}`, knowledgeId: k.id });
      // eslint-disable-next-line no-await-in-loop
      await applyOutcomeReinforcement({ trace_id: `neg-${i}`, agent_name: AGENT_NAMES.SEO_ANALYST }, 'declined');
    }
    const reloaded = await AgentKnowledge.findByPk(k.id);
    expect(reloaded.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
    expect(reloaded.confidence).toBe(MIN_CONFIDENCE); // clamped, not overshot
  });
});

describe('knowledgeStore.reinforceKnowledge — the low-level primitive directly', () => {
  test('returns null for a nonexistent id, never throws', async () => {
    const result = await knowledgeStore.reinforceKnowledge(999999, {
      success: true,
      minSamples: 3,
      positiveDelta: 0.03,
      negativeDelta: 0.03,
      minConfidence: 0,
      maxConfidence: 0.95,
    });
    expect(result).toBeNull();
  });
});
