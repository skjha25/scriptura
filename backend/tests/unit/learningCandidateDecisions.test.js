// backend/tests/unit/learningCandidateDecisions.test.js
'use strict';

/**
 * P4-D tests: services/agents/learningCandidateDecisions.js — the human
 * confirm/reject gate. Real (unmocked) knowledgeBase.confirmKnowledgeBatch
 * is exercised end-to-end against in-memory SQLite, so these tests prove a
 * confirm genuinely produces a real agent_knowledge row through the
 * existing, unmodified writer — not a parallel path. embedClaim (OpenAI) is
 * mocked so no real network call happens.
 */

jest.mock('../../src/services/agents/knowledge/knowledgeEmbedding', () => ({
  embedText: jest.fn().mockResolvedValue(null),
  embedClaim: jest.fn().mockResolvedValue(null),
  cosineSimilarity: jest.fn(),
}));

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
  const KnowledgeSource = require('../../src/models/knowledgeSource')(sqlite);
  const SourceChunk = require('../../src/models/sourceChunk')(sqlite);

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

  AgentKnowledge.belongsTo(KnowledgeSource, { foreignKey: 'source_id', as: 'source', constraints: false });
  KnowledgeSource.hasMany(SourceChunk, { foreignKey: 'source_id', as: 'chunks', constraints: false });

  return {
    User,
    AgentActivity,
    AgentRecommendation,
    RecommendationAction,
    RecommendationOutcome,
    LearningCandidate,
    AgentKnowledge,
    KnowledgeSource,
    SourceChunk,
    sequelize: sqlite,
    Sequelize,
  };
});

const { AGENT_NAMES } = require('../../src/constants');
const { LearningCandidate, AgentKnowledge, sequelize } = require('../../src/models');
const {
  confirmLearningCandidate,
  rejectLearningCandidate,
  listLearningCandidates,
  candidateDirection,
  findContradictingConfirmedCandidate,
} = require('../../src/services/agents/learningCandidateDecisions');

async function makeCandidate(overrides = {}) {
  return LearningCandidate.create({
    pattern_key: 'action_type:seo_analyst_agent:blog.update_seo_fields',
    scope: 'agent',
    agent_name: AGENT_NAMES.SEO_ANALYST,
    category: 'outcome_pattern',
    topic: 'blog.update_seo_fields',
    claim: 'Across 5 observed outcomes, action type "blog.update_seo_fields" tended to improve the target metric in 80% of cases.',
    evidence: 'improved: 4, declined: 1, neutral: 0, inconclusive: 0 (sample_size: 5).',
    sample_size: 5,
    improved_count: 4,
    declined_count: 1,
    neutral_count: 0,
    inconclusive_count: 0,
    confidence: 0.8,
    evidence_refs: [{ type: 'recommendation_outcome', id: 1 }, { type: 'recommendation_outcome', id: 2 }],
    status: 'pending_review',
    ...overrides,
  });
}

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  await LearningCandidate.destroy({ truncate: true });
  await AgentKnowledge.destroy({ truncate: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('confirmLearningCandidate — writes through the existing knowledge writer only', () => {
  test('confirms and creates exactly one real agent_knowledge row via confirmKnowledgeBatch', async () => {
    const candidate = await makeCandidate();

    const confirmed = await confirmLearningCandidate(candidate.id, { userId: 7 });

    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.reviewed_by).toBe(7);
    expect(confirmed.confirmed_knowledge_id).not.toBeNull();

    expect(await AgentKnowledge.count()).toBe(1);
    const knowledgeRow = await AgentKnowledge.findByPk(confirmed.confirmed_knowledge_id);
    expect(knowledgeRow.claim).toBe(candidate.claim);
    expect(knowledgeRow.source_type).toBe('outcome_feedback');
    expect(knowledgeRow.knowledge_type).toBe('pattern');
    expect(knowledgeRow.agent_name).toBe(AGENT_NAMES.SEO_ANALYST);
  });

  test('default scope is "agent" — matches confirmKnowledgeBatch default, never global unless requested', async () => {
    const candidate = await makeCandidate();
    const confirmed = await confirmLearningCandidate(candidate.id, { userId: 7 });
    const knowledgeRow = await AgentKnowledge.findByPk(confirmed.confirmed_knowledge_id);
    expect(knowledgeRow.scope).toBe('agent');
  });

  test('explicit global promotion path — scope:"global" only when the reviewer explicitly requests it', async () => {
    const candidate = await makeCandidate();
    const confirmed = await confirmLearningCandidate(candidate.id, { scope: 'global', userId: 7 });
    const knowledgeRow = await AgentKnowledge.findByPk(confirmed.confirmed_knowledge_id);
    expect(knowledgeRow.scope).toBe('global');
  });

  test('the learning_candidates row itself is never global-scoped by confirm — only the resulting agent_knowledge row is', async () => {
    const candidate = await makeCandidate();
    const confirmed = await confirmLearningCandidate(candidate.id, { scope: 'global', userId: 7 });
    expect(confirmed.scope).toBe('agent'); // the candidate row's own scope is untouched by confirm
  });

  test('confirming an already-confirmed candidate is an idempotent no-op — does not create a second agent_knowledge row', async () => {
    const candidate = await makeCandidate();
    const first = await confirmLearningCandidate(candidate.id, { userId: 7 });
    const second = await confirmLearningCandidate(candidate.id, { userId: 9 });

    expect(second.status).toBe('confirmed');
    expect(second.confirmed_knowledge_id).toBe(first.confirmed_knowledge_id);
    expect(await AgentKnowledge.count()).toBe(1);
  });

  test('confirming an already-rejected candidate is a 409 conflict, never silently re-processed', async () => {
    const candidate = await makeCandidate();
    await rejectLearningCandidate(candidate.id, { userId: 7 });

    await expect(confirmLearningCandidate(candidate.id, { userId: 9 })).rejects.toMatchObject({
      statusCode: 409,
      code: 'LEARNING_CANDIDATE_NOT_PENDING',
    });
    expect(await AgentKnowledge.count()).toBe(0);
  });

  test('a nonexistent candidate id is a 404, not a crash', async () => {
    await expect(confirmLearningCandidate(999999, { userId: 1 })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('rejectLearningCandidate — writes nothing to agent_knowledge', () => {
  test('rejects and never creates any agent_knowledge row', async () => {
    const candidate = await makeCandidate();
    const rejected = await rejectLearningCandidate(candidate.id, { userId: 7 });

    expect(rejected.status).toBe('rejected');
    expect(rejected.reviewed_by).toBe(7);
    expect(rejected.confirmed_knowledge_id).toBeNull();
    expect(await AgentKnowledge.count()).toBe(0);
  });

  test('duplicate reject is an idempotent no-op', async () => {
    const candidate = await makeCandidate();
    const first = await rejectLearningCandidate(candidate.id, { userId: 7 });
    const second = await rejectLearningCandidate(candidate.id, { userId: 9 });
    expect(second.status).toBe('rejected');
    expect(second.reviewed_by).toBe(7); // first decision wins
  });

  test('rejecting an already-confirmed candidate is a 409 conflict', async () => {
    const candidate = await makeCandidate();
    await confirmLearningCandidate(candidate.id, { userId: 7 });
    await expect(rejectLearningCandidate(candidate.id, { userId: 9 })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('P5-C — contradiction detection (candidateDirection, findContradictingConfirmedCandidate)', () => {
  test('candidateDirection is deterministic, non-LLM: derived purely from stored counts', () => {
    expect(candidateDirection({ sample_size: 5, improved_count: 4, declined_count: 1 })).toBe('improved');
    expect(candidateDirection({ sample_size: 5, improved_count: 1, declined_count: 4 })).toBe('declined');
    expect(candidateDirection({ sample_size: 5, improved_count: 2, declined_count: 2 })).toBeNull(); // no clear majority
    expect(candidateDirection({ sample_size: 4, improved_count: 4, declined_count: 0 })).toBeNull(); // below MIN_SAMPLE_SIZE_FOR_CANDIDATE
  });

  test('1. same-direction new evidence for the same pattern -> no contradiction, verdict stays "new"', async () => {
    const first = await makeCandidate({ pattern_key: 'p1' }); // improved (4/1)
    await confirmLearningCandidate(first.id, { userId: 1 });

    const second = await makeCandidate({ pattern_key: 'p1', improved_count: 5, declined_count: 0, sample_size: 5 }); // also improved
    const match = await findContradictingConfirmedCandidate(second);
    expect(match).toBeNull();

    const confirmedSecond = await confirmLearningCandidate(second.id, { userId: 1 });
    const knowledgeRow = await AgentKnowledge.findByPk(confirmedSecond.confirmed_knowledge_id);
    expect(knowledgeRow.status).toBe('unverified'); // the plain 'new' branch, not 'contested'
    expect(knowledgeRow.related_knowledge_ids).toBeNull();
  });

  test('2. opposite-direction evidence that never crossed P4\'s own eligibility bar never reaches contradiction detection', async () => {
    // A candidate object shaped like something that should never have existed
    // as pending_review in the first place (below MIN_SAMPLE_SIZE_FOR_CANDIDATE) —
    // candidateDirection correctly refuses to assign it a direction at all,
    // so findContradictingConfirmedCandidate can never treat it as a contradiction.
    const insufficient = { pattern_key: 'p2', agent_name: AGENT_NAMES.SEO_ANALYST, sample_size: 3, improved_count: 0, declined_count: 3, id: 999999 };
    expect(candidateDirection(insufficient)).toBeNull();
    expect(await findContradictingConfirmedCandidate(insufficient)).toBeNull();
  });

  test('3/4/5/6. opposite-direction evidence meeting threshold -> BOTH rows become contested, correctly cross-linked, neither auto-selected as winner', async () => {
    const original = await makeCandidate({ pattern_key: 'p3' }); // improved (4/1)
    const confirmedOriginal = await confirmLearningCandidate(original.id, { userId: 1 });
    const originalKnowledgeId = confirmedOriginal.confirmed_knowledge_id;

    const opposite = await makeCandidate({
      pattern_key: 'p3',
      claim: 'Across 5 observed outcomes, action type "blog.update_seo_fields" tended to decline the target metric in 80% of cases.',
      improved_count: 1,
      declined_count: 4,
    });
    const match = await findContradictingConfirmedCandidate(opposite);
    expect(match).not.toBeNull();
    expect(match.knowledgeId).toBe(originalKnowledgeId);

    const confirmedOpposite = await confirmLearningCandidate(opposite.id, { userId: 2 });
    const newKnowledgeId = confirmedOpposite.confirmed_knowledge_id;
    expect(newKnowledgeId).not.toBe(originalKnowledgeId);

    // 4. Both knowledge rows remain present.
    expect(await AgentKnowledge.count()).toBe(2);

    // 3/6. Both contested, neither auto-confirmed/rejected/deleted as a "winner".
    const reloadedOriginal = await AgentKnowledge.findByPk(originalKnowledgeId);
    const reloadedNew = await AgentKnowledge.findByPk(newKnowledgeId);
    expect(reloadedOriginal.status).toBe('contested');
    expect(reloadedNew.status).toBe('contested');
    expect(reloadedOriginal.claim).toBe(original.claim); // claim text never rewritten
    expect(reloadedNew.claim).toBe(opposite.claim);

    // 5. related_knowledge_ids links the pair in both directions.
    expect(reloadedOriginal.related_knowledge_ids).toEqual([newKnowledgeId]);
    expect(reloadedNew.related_knowledge_ids).toEqual([originalKnowledgeId]);
  });

  test('9. Agent A\'s contradiction detection never matches Agent B\'s knowledge, even for the identically-worded topic', async () => {
    const seoOriginal = await makeCandidate({ pattern_key: 'action_type:seo_analyst_agent:x', agent_name: AGENT_NAMES.SEO_ANALYST });
    await confirmLearningCandidate(seoOriginal.id, { userId: 1 });

    const blogOpsOpposite = await makeCandidate({
      pattern_key: 'action_type:blog_ops_agent:x', // different pattern_key (different agent segment)
      agent_name: AGENT_NAMES.BLOG_OPS,
      improved_count: 1,
      declined_count: 4,
    });
    const match = await findContradictingConfirmedCandidate(blogOpsOpposite);
    expect(match).toBeNull(); // no cross-agent match, despite the opposite direction

    const confirmedBlogOps = await confirmLearningCandidate(blogOpsOpposite.id, { userId: 1 });
    const blogOpsKnowledge = await AgentKnowledge.findByPk(confirmedBlogOps.confirmed_knowledge_id);
    expect(blogOpsKnowledge.status).toBe('unverified'); // plain 'new', not contested

    // Agent A's original row is completely untouched.
    const seoKnowledge = await AgentKnowledge.findByPk((await LearningCandidate.findByPk(seoOriginal.id)).confirmed_knowledge_id);
    expect(seoKnowledge.status).toBe('unverified'); // untouched — still its original, un-contested status
    expect(seoKnowledge.related_knowledge_ids).toBeNull();
  });

  test('10/11. contesting a GLOBAL-scope row never changes its scope — global stays global, agent-scope never silently promoted', async () => {
    const original = await makeCandidate({ pattern_key: 'p-global' });
    const confirmedOriginal = await confirmLearningCandidate(original.id, { scope: 'global', userId: 1 }); // explicit human choice
    const originalKnowledge = await AgentKnowledge.findByPk(confirmedOriginal.confirmed_knowledge_id);
    expect(originalKnowledge.scope).toBe('global');

    const opposite = await makeCandidate({ pattern_key: 'p-global', improved_count: 1, declined_count: 4 });
    // The NEW confirm is done WITHOUT requesting global — must default to 'agent'.
    const confirmedOpposite = await confirmLearningCandidate(opposite.id, { userId: 2 });
    const newKnowledge = await AgentKnowledge.findByPk(confirmedOpposite.confirmed_knowledge_id);

    expect(newKnowledge.scope).toBe('agent'); // never silently promoted to global just because it contests one
    const reloadedOriginal = await AgentKnowledge.findByPk(originalKnowledge.id);
    expect(reloadedOriginal.scope).toBe('global'); // stays global — contradiction never touches scope
    expect(reloadedOriginal.status).toBe('contested');
  });

  test('7/12. re-confirming an already-confirmed (now contested) candidate is idempotent — no duplicate contradiction, no row deleted', async () => {
    const original = await makeCandidate({ pattern_key: 'p-idempotent' });
    await confirmLearningCandidate(original.id, { userId: 1 });
    const opposite = await makeCandidate({ pattern_key: 'p-idempotent', improved_count: 1, declined_count: 4 });
    const first = await confirmLearningCandidate(opposite.id, { userId: 2 });

    const countBefore = await AgentKnowledge.count();
    const second = await confirmLearningCandidate(opposite.id, { userId: 3 }); // repeat confirm on the SAME already-confirmed candidate

    expect(second.confirmed_knowledge_id).toBe(first.confirmed_knowledge_id); // same row, not a new one
    expect(await AgentKnowledge.count()).toBe(countBefore); // 12. nothing created, nothing deleted
  });

  test('8a. genuinely new evidence for a pattern is still eligible for its own contradiction check, as long as the row it would contest is still live (not already contested)', async () => {
    const first = await makeCandidate({ pattern_key: 'p-fresh-a' });
    await confirmLearningCandidate(first.id, { userId: 1 }); // row A: live, 'unverified', direction improved

    // Later, genuinely new evidence for the SAME pattern trends the SAME direction -> no contradiction (already covered by test 1, re-asserted here for the sequencing).
    const sameDirection = await makeCandidate({ pattern_key: 'p-fresh-a', improved_count: 5, declined_count: 0 });
    expect(await findContradictingConfirmedCandidate(sameDirection)).toBeNull();
    await confirmLearningCandidate(sameDirection.id, { userId: 1 });

    // Still later, genuinely new evidence trends the OPPOSITE direction -> row A is still live (never contested), so this correctly fires.
    const opposite = await makeCandidate({ pattern_key: 'p-fresh-a', improved_count: 1, declined_count: 4 });
    const match = await findContradictingConfirmedCandidate(opposite);
    expect(match).not.toBeNull();
  });

  test('8b. once a pattern is already contested, a further new candidate does NOT chain a second automatic contest onto the already-flagged row — it defaults to plain "new" rather than clobbering the existing contested pair\'s related_knowledge_ids', async () => {
    const first = await makeCandidate({ pattern_key: 'p-fresh-b' });
    await confirmLearningCandidate(first.id, { userId: 1 });
    const opposite = await makeCandidate({ pattern_key: 'p-fresh-b', improved_count: 1, declined_count: 4 });
    const confirmedOpposite = await confirmLearningCandidate(opposite.id, { userId: 2 }); // now BOTH rows are 'contested', linked to each other

    const contestedKnowledgeId = confirmedOpposite.confirmed_knowledge_id;
    const contestedRowBefore = await AgentKnowledge.findByPk(contestedKnowledgeId);
    expect(contestedRowBefore.status).toBe('contested');

    // A third candidate for the same pattern — the most recent CONFIRMED
    // candidate (`opposite`) now points at an already-contested knowledge
    // row, so this must NOT re-trigger automatic contesting.
    const third = await makeCandidate({ pattern_key: 'p-fresh-b', improved_count: 5, declined_count: 0 });
    expect(await findContradictingConfirmedCandidate(third)).toBeNull();

    await confirmLearningCandidate(third.id, { userId: 3 });

    // The already-contested pair's own related_knowledge_ids link is untouched.
    const contestedRowAfter = await AgentKnowledge.findByPk(contestedKnowledgeId);
    expect(contestedRowAfter.status).toBe('contested');
    expect(contestedRowAfter.related_knowledge_ids).toEqual(contestedRowBefore.related_knowledge_ids);
  });

  test('15. no LLM/provider call anywhere in the contradiction path — confirmKnowledgeEmbedding is the only external call and it is already mocked/optional', () => {
    const source = require('fs').readFileSync(
      require.resolve('../../src/services/agents/learningCandidateDecisions.js'),
      'utf8'
    );
    expect(source).not.toMatch(/runAgentStep|getTextProvider|anthropic|openai/i);
  });
});

describe('listLearningCandidates', () => {
  test('filters by status and agent_name', async () => {
    await makeCandidate({ pattern_key: 'a', status: 'pending_review' });
    await makeCandidate({ pattern_key: 'b', status: 'pending_review', agent_name: AGENT_NAMES.BLOG_OPS });
    await makeCandidate({ pattern_key: 'c', status: 'rejected' });

    const pending = await listLearningCandidates({ status: 'pending_review' });
    expect(pending).toHaveLength(2);

    const seoOnly = await listLearningCandidates({ status: 'pending_review', agentName: AGENT_NAMES.SEO_ANALYST });
    expect(seoOnly).toHaveLength(1);
  });
});
