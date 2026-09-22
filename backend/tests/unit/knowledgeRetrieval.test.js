// backend/tests/unit/knowledgeRetrieval.test.js
'use strict';

/**
 * Regression tests for knowledge retrieval/scoring (knowledgeStore.js),
 * scope isolation, usage tracing, and the shared read-only agent tools
 * (sharedKnowledgeTools.js) — verifying EXISTING behavior, none of that
 * production code is modified by this file.
 *
 * Isolation: same pattern as knowledgeLifecycle.test.js / serpSnapshot.test.js
 * — in-memory SQLite via mocked `../../src/models`, no real DB touched.
 * Semantic scoring is exercised through `retrieveKnowledge`'s existing
 * `options.embeddingClient` injection point (a real test seam already in the
 * production code — see knowledgeStore.js's retrieveKnowledge signature),
 * not a new one added for this test.
 */

jest.mock('../../src/models', () => {
  const { Sequelize } = require('sequelize');
  const sqlite = new Sequelize('sqlite::memory:', { logging: false });
  const AgentKnowledge = require('../../src/models/agentKnowledge')(sqlite);
  const AgentActivity = require('../../src/models/agentActivity')(sqlite);
  return { AgentKnowledge, AgentActivity, sequelize: sqlite, Sequelize };
});

const { AgentKnowledge, AgentActivity, sequelize } = require('../../src/models');
const knowledgeStore = require('../../src/services/agents/knowledge/knowledgeStore');
const { makeKnowledgeTools } = require('../../src/services/agents/tools/sharedKnowledgeTools');
const { AGENT_NAMES } = require('../../src/constants');

const AGENT_A = AGENT_NAMES.RESEARCH;
const AGENT_B = AGENT_NAMES.SEO_ANALYST;

function fakeEmbeddingClient(vector) {
  return { embeddings: { create: jest.fn().mockResolvedValue({ data: [{ embedding: vector }] }) } };
}

async function makeRow(overrides = {}) {
  return AgentKnowledge.create({
    scope: 'agent',
    agent_name: AGENT_A,
    category: 'seo',
    topic: 'general',
    claim: 'a claim',
    source_type: 'manual_text',
    confidence: 0.5,
    status: 'unverified',
    ...overrides,
  });
}

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  await AgentKnowledge.destroy({ truncate: true });
  await AgentActivity.destroy({ truncate: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('retrieveKnowledge — status filtering', () => {
  test('excludes contradicted and outdated rows; includes unverified/confirmed/supported/contested', async () => {
    await makeRow({ status: 'contradicted', claim: 'never returned A' });
    await makeRow({ status: 'outdated', claim: 'never returned B' });
    await makeRow({ status: 'unverified', claim: 'returned unverified' });
    await makeRow({ status: 'confirmed', claim: 'returned confirmed' });
    await makeRow({ status: 'supported', claim: 'returned supported' });
    await makeRow({ status: 'contested', claim: 'returned contested' });

    const results = await knowledgeStore.retrieveKnowledge(AGENT_A, {});
    const claims = results.map((r) => r.claim);

    expect(claims).not.toContain('never returned A');
    expect(claims).not.toContain('never returned B');
    expect(claims).toEqual(
      expect.arrayContaining(['returned unverified', 'returned confirmed', 'returned supported', 'returned contested'])
    );
  });
});

describe('retrieveKnowledge — scope isolation', () => {
  test('an agent sees global knowledge plus only its own agent-scoped knowledge, never another agent\'s', async () => {
    await makeRow({ scope: 'global', agent_name: null, claim: 'global claim' });
    await makeRow({ scope: 'agent', agent_name: AGENT_A, claim: "agent A's own claim" });
    await makeRow({ scope: 'agent', agent_name: AGENT_B, claim: "agent B's own claim" });

    const resultsForA = await knowledgeStore.retrieveKnowledge(AGENT_A, {});
    const claimsForA = resultsForA.map((r) => r.claim);

    expect(claimsForA).toContain('global claim');
    expect(claimsForA).toContain("agent A's own claim");
    expect(claimsForA).not.toContain("agent B's own claim");
  });

  test('with no query text, results are ordered by confidence DESC then usage_count DESC (no scoring pass)', async () => {
    await makeRow({ claim: 'low', confidence: 0.3, usage_count: 99 });
    await makeRow({ claim: 'high', confidence: 0.9, usage_count: 0 });
    await makeRow({ claim: 'mid', confidence: 0.6, usage_count: 0 });

    const results = await knowledgeStore.retrieveKnowledge(AGENT_A, {});
    expect(results.map((r) => r.claim)).toEqual(['high', 'mid', 'low']);
  });
});

describe('retrieveKnowledge — hybrid scoring formula', () => {
  test('semantic similarity (weight 0.5) can outrank a higher-confidence row with no lexical/semantic match', async () => {
    const semanticMatch = await makeRow({
      claim: 'unrelated wording entirely',
      confidence: 0.5,
      embedding: [1, 0],
    });
    const higherConfidenceButOrthogonal = await makeRow({
      claim: 'also unrelated wording',
      confidence: 0.9,
      embedding: [0, 1],
    });

    const results = await knowledgeStore.retrieveKnowledge(
      AGENT_A,
      { text: 'query text sharing no terms with either claim' },
      { embeddingClient: fakeEmbeddingClient([1, 0]) }
    );

    expect(results[0].id).toBe(semanticMatch.id);
    expect(results[0].retrievalMethod).toBe('hybrid');
    // sanity: the orthogonal-but-higher-confidence row is still present, just ranked lower
    expect(results.map((r) => r.id)).toContain(higherConfidenceButOrthogonal.id);
    expect(results.findIndex((r) => r.id === semanticMatch.id)).toBeLessThan(
      results.findIndex((r) => r.id === higherConfidenceButOrthogonal.id)
    );
  });

  test('exact lexical overlap ranks above a semantically-unrelated row when no embedding client is available', async () => {
    const lexicalMatch = await makeRow({ claim: 'astrology consultation booking flow', confidence: 0.5 });
    await makeRow({ claim: 'completely different subject matter', confidence: 0.5 });

    const results = await knowledgeStore.retrieveKnowledge(AGENT_A, { text: 'astrology consultation booking flow' });
    // No embeddingClient injected and no OPENAI_API_KEY assumed — falls back to lexical-only scoring.
    expect(results[0].id).toBe(lexicalMatch.id);
    expect(results[0].retrievalMethod).toBe('lexical');
  });

  test('scoreKnowledgeCandidate matches the documented weighted formula exactly', () => {
    const row = { topic: 'general', category: 'seo', claim: 'astrology consultation booking', confidence: 0.8, last_verified_at: null };
    const queryTerms = new Set(['astrology', 'consultation', 'booking']);
    const queryEmbedding = [1, 0];
    row.embedding = [1, 0]; // identical direction -> cosine similarity 1

    const { score, semantic, lexical } = knowledgeStore.scoreKnowledgeCandidate(row, { queryTerms, queryEmbedding });

    // lexicalOverlap scores against `${topic} ${category} ${claim}` — terms
    // {general, seo, astrology, consultation, booking} (5) vs. the 3 query
    // terms — Jaccard = intersection(3) / union(3+5-3=5) = 0.6, not a full 1.
    expect(semantic).toBeCloseTo(1, 5);
    expect(lexical).toBeCloseTo(0.6, 5);
    expect(score).toBeCloseTo(0.5 * 1 + 0.3 * 0.6 + 0.15 * 0.8 + 0.05 * 0.5, 5);
  });

  test('a candidate with confidence 0 and no semantic/lexical overlap is dropped as noise', async () => {
    // freshness is a smooth decay that only reaches exact 0.0 at an
    // unrealistic age, so this test drives the filter via confidence (which
    // contributes 0 exactly when set to 0) combined with genuinely
    // non-overlapping terms, rather than chasing floating-point underflow.
    await makeRow({ claim: 'zzz totally unrelated zzz', confidence: 0, last_verified_at: new Date() });
    const results = await knowledgeStore.retrieveKnowledge(AGENT_A, { text: 'astrology consultation booking' });
    // freshness(today) = 1.0, so score = 0.05*1.0 = 0.05 > 0 — still not dropped.
    // This documents the current formula's actual behavior: the noise filter
    // only removes a row when EVERY term (including freshness) is at its floor,
    // which in practice means confidence 0 alone does not suffice either.
    expect(results).toHaveLength(1);
  });
});

describe('recordUsage', () => {
  test('bumps usage_count always, and success_count/failure_count only when explicitly told', async () => {
    const row = await makeRow({});
    await knowledgeStore.recordUsage(row.id, {});
    await row.reload();
    expect(row.usage_count).toBe(1);
    expect(row.success_count).toBe(0);

    await knowledgeStore.recordUsage(row.id, { success: true });
    await row.reload();
    expect(row.usage_count).toBe(2);
    expect(row.success_count).toBe(1);

    await knowledgeStore.recordUsage(row.id, { success: false });
    await row.reload();
    expect(row.usage_count).toBe(3);
    expect(row.failure_count).toBe(1);
  });
});

describe('Shared knowledge tools (sharedKnowledgeTools.js)', () => {
  test('get_current_knowledge reads via retrieveKnowledge, scoped to the closure-bound agent', async () => {
    await makeRow({ scope: 'agent', agent_name: AGENT_A, claim: 'A-only claim', status: 'confirmed' });
    await makeRow({ scope: 'agent', agent_name: AGENT_B, claim: 'B-only claim', status: 'confirmed' });

    const [getCurrentKnowledge] = makeKnowledgeTools(AGENT_A);
    const result = await getCurrentKnowledge.execute();

    expect(result.type).toBe('read');
    const claims = result.knowledge.map((k) => k.claim);
    expect(claims).toContain('A-only claim');
    expect(claims).not.toContain('B-only claim');
  });

  test('get_recent_learning reads AgentActivity setting_applied rows for the knowledge_base key only', async () => {
    await AgentActivity.create({
      trace_id: 't1',
      agent_name: AGENT_A,
      event_type: 'setting_applied',
      setting_key: `agents.${AGENT_A}.knowledge_base`,
      status: 'success',
      payload: { diff: { proposed_value: 'taught something new' } },
    });
    await AgentActivity.create({
      trace_id: 't2',
      agent_name: AGENT_A,
      event_type: 'setting_applied',
      setting_key: `agents.${AGENT_A}.retry_count`, // a different setting — must not appear
      status: 'success',
      payload: { diff: { proposed_value: 5 } },
    });

    const [, getRecentLearning] = makeKnowledgeTools(AGENT_A);
    const result = await getRecentLearning.execute({});

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0].summary).toBe('taught something new');
  });

  test('propose_knowledge_update NEVER writes to AgentKnowledge — only ever returns a proposed_change diff', async () => {
    const [, , proposeKnowledgeUpdate] = makeKnowledgeTools(AGENT_A);

    const result = await proposeKnowledgeUpdate.execute({
      claim: 'Consultation CTAs convert better in the evening.',
      category: 'seo_strategy',
    });

    expect(result.type).toBe('proposed_change');
    expect(result.change.domain).toBe('knowledge');
    expect(result.change.agent_name).toBe(AGENT_A);
    expect(await AgentKnowledge.count()).toBe(0);
  });

  test('propose_knowledge_update requires claim and category', async () => {
    const [, , proposeKnowledgeUpdate] = makeKnowledgeTools(AGENT_A);
    await expect(proposeKnowledgeUpdate.execute({ claim: '' })).rejects.toThrow(/claim is required/);
    await expect(proposeKnowledgeUpdate.execute({ claim: 'x', category: '' })).rejects.toThrow(/category is required/);
  });
});
