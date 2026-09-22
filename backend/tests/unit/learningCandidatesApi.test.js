// backend/tests/unit/learningCandidatesApi.test.js
'use strict';

/**
 * P4-D tests: the real HTTP wiring for learning candidate review
 * (routes/v1/agents.routes.js -> controllers/agents.controller.js ->
 * services/agents/learningCandidateDecisions.js), reusing the REAL,
 * unmodified requireAuth/requireAdmin middleware and REAL services/tokens.js
 * signing — only the models layer is mocked (in-memory SQLite), same
 * pattern as recommendationActionsApi.test.js (P1-B2) and
 * outcomeApi.test.js (P2-D). embedText is mocked so confirm never makes a
 * real OpenAI call.
 */

jest.mock('../../src/services/agents/knowledge/knowledgeEmbedding', () => ({
  embedText: jest.fn().mockResolvedValue(null),
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
const { User, LearningCandidate, AgentKnowledge, sequelize } = require('../../src/models');

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
    evidence_refs: [{ type: 'recommendation_outcome', id: 1 }],
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
  await User.destroy({ truncate: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('Learning candidate review API (real HTTP + real auth)', () => {
  const request = require('supertest');
  const { signAccessToken } = require('../../src/services/tokens');
  let app;
  let adminUser;
  let editorUser;

  beforeAll(() => {
    const { createApp } = require('../../src/app');
    app = createApp();
  });

  beforeEach(async () => {
    adminUser = await User.create({ name: 'Admin', email: 'admin@test.local', password_hash: 'x', role: 'admin', is_active: true });
    editorUser = await User.create({ name: 'Editor', email: 'editor@test.local', password_hash: 'x', role: 'editor', is_active: true });
  });

  function tokenFor(user) {
    return signAccessToken({ id: user.id, email: user.email, role: user.role });
  }

  test('1. an unauthenticated list request is rejected (401)', async () => {
    const res = await request(app).get('/api/v1/agents/learning-candidates');
    expect(res.status).toBe(401);
  });

  test('2. a non-admin (editor) request is rejected (403)', async () => {
    const res = await request(app)
      .get('/api/v1/agents/learning-candidates')
      .set('Authorization', `Bearer ${tokenFor(editorUser)}`);
    expect(res.status).toBe(403);
  });

  test('3. GET /learning-candidates lists pending candidates, filterable by status/agent_name', async () => {
    await makeCandidate();
    await makeCandidate({ pattern_key: 'x', agent_name: AGENT_NAMES.BLOG_OPS });

    const res = await request(app)
      .get('/api/v1/agents/learning-candidates')
      .query({ status: 'pending_review', agent_name: AGENT_NAMES.SEO_ANALYST })
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].agent_name).toBe(AGENT_NAMES.SEO_ANALYST);
  });

  test('4. full lifecycle: confirm over real HTTP creates a real agent_knowledge row, reviewed_by from the authenticated session', async () => {
    const candidate = await makeCandidate();

    const res = await request(app)
      .post(`/api/v1/agents/learning-candidates/${candidate.id}/confirm`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('confirmed');
    expect(res.body.data.reviewed_by).toBe(adminUser.id);
    expect(res.body.data.confirmed_knowledge_id).not.toBeNull();
    expect(await AgentKnowledge.count()).toBe(1);
  });

  test('5. confirm defaults to scope:"agent" when omitted from the request body', async () => {
    const candidate = await makeCandidate();
    const res = await request(app)
      .post(`/api/v1/agents/learning-candidates/${candidate.id}/confirm`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`)
      .send({});
    const knowledgeRow = await AgentKnowledge.findByPk(res.body.data.confirmed_knowledge_id);
    expect(knowledgeRow.scope).toBe('agent');
  });

  test('6. confirm with scope:"global" explicitly requested promotes to global — never the default', async () => {
    const candidate = await makeCandidate();
    const res = await request(app)
      .post(`/api/v1/agents/learning-candidates/${candidate.id}/confirm`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`)
      .send({ scope: 'global' });
    const knowledgeRow = await AgentKnowledge.findByPk(res.body.data.confirmed_knowledge_id);
    expect(knowledgeRow.scope).toBe('global');
  });

  test('7. an invalid scope value is rejected by validation (422), not silently coerced', async () => {
    const candidate = await makeCandidate();
    const res = await request(app)
      .post(`/api/v1/agents/learning-candidates/${candidate.id}/confirm`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`)
      .send({ scope: 'not-a-real-scope' });
    expect(res.status).toBe(422);
  });

  test('8. reject over real HTTP — creates no agent_knowledge row', async () => {
    const candidate = await makeCandidate();
    const res = await request(app)
      .post(`/api/v1/agents/learning-candidates/${candidate.id}/reject`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('rejected');
    expect(await AgentKnowledge.count()).toBe(0);
  });

  test('9. confirming an already-rejected candidate is a 409, not a silent success', async () => {
    const candidate = await makeCandidate();
    await request(app)
      .post(`/api/v1/agents/learning-candidates/${candidate.id}/reject`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);

    const res = await request(app)
      .post(`/api/v1/agents/learning-candidates/${candidate.id}/confirm`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LEARNING_CANDIDATE_NOT_PENDING');
  });

  test('10. a nonexistent candidate id returns 404', async () => {
    const res = await request(app)
      .post('/api/v1/agents/learning-candidates/999999/confirm')
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`)
      .send({});
    expect(res.status).toBe(404);
  });

  test('11. an executed_by/reviewed_by spoof attempt in the confirm body is rejected by validation, not silently accepted', async () => {
    const candidate = await makeCandidate();
    const res = await request(app)
      .post(`/api/v1/agents/learning-candidates/${candidate.id}/confirm`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`)
      .send({ reviewed_by: 999999 });
    expect(res.status).toBe(422); // .strict() schema has no reviewed_by field — rejected outright
  });
});
