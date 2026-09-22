// backend/tests/unit/observatoryApi.test.js
'use strict';

/**
 * P5-D tests: the real HTTP wiring for the Intelligence Observatory
 * (routes/v1/agents.routes.js -> controllers/agents.controller.js ->
 * services/agents/observatory.js), reusing the REAL, unmodified
 * requireAuth/requireAdmin middleware and REAL token signing — only the
 * models layer is mocked (in-memory SQLite), same pattern as
 * learningCandidatesApi.test.js.
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
  const AgentKnowledgeUsage = require('../../src/models/agentKnowledgeUsage')(sqlite);
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
    AgentKnowledgeUsage,
    KnowledgeSource,
    SourceChunk,
    sequelize: sqlite,
    Sequelize,
  };
});

const { AGENT_NAMES } = require('../../src/constants');
const { User, AgentKnowledge, sequelize } = require('../../src/models');

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  await AgentKnowledge.destroy({ truncate: true });
  await User.destroy({ truncate: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('Intelligence Observatory API (real HTTP + real auth)', () => {
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

  test('an unauthenticated request to any observatory route is rejected (401)', async () => {
    const res = await request(app).get('/api/v1/agents/observatory/summary');
    expect(res.status).toBe(401);
  });

  test('a non-admin (editor) request is rejected (403)', async () => {
    const res = await request(app)
      .get('/api/v1/agents/observatory/summary')
      .set('Authorization', `Bearer ${tokenFor(editorUser)}`);
    expect(res.status).toBe(403);
  });

  test('GET /observatory/summary returns real live counters', async () => {
    const res = await request(app)
      .get('/api/v1/agents/observatory/summary')
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ knowledgeItems: 0, pendingCandidates: 0 });
  });

  test('GET /observatory/agents returns one status row per observed agent, excluding Generate Agent', async () => {
    const res = await request(app)
      .get('/api/v1/agents/observatory/agents')
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.some((a) => a.agentName === AGENT_NAMES.GENERATE)).toBe(false);
    expect(res.body.data.some((a) => a.agentName === AGENT_NAMES.SEO_ANALYST)).toBe(true);
  });

  test('GET /observatory/activity respects the limit query param and rejects an out-of-range one (422)', async () => {
    const ok = await request(app)
      .get('/api/v1/agents/observatory/activity')
      .query({ limit: 5 })
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);
    expect(ok.status).toBe(200);

    const badLimit = await request(app)
      .get('/api/v1/agents/observatory/activity')
      .query({ limit: 500 })
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);
    expect(badLimit.status).toBe(422);
  });

  test('GET /observatory/knowledge-health returns real health data, scoped by agent_name', async () => {
    await AgentKnowledge.create({
      scope: 'agent',
      agent_name: AGENT_NAMES.SEO_ANALYST,
      category: 'seo_strategy',
      topic: 't',
      claim: 'c',
      source_type: 'manual_text',
      confidence: 0.5,
      status: 'confirmed',
    });
    const res = await request(app)
      .get('/api/v1/agents/observatory/knowledge-health')
      .query({ agent_name: AGENT_NAMES.SEO_ANALYST })
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
  });

  test('GET /observatory/knowledge-nodes rejects an invalid agent_name (422)', async () => {
    const res = await request(app)
      .get('/api/v1/agents/observatory/knowledge-nodes')
      .query({ agent_name: 'not_a_real_agent' })
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);
    expect(res.status).toBe(422);
  });

  test('GET /observatory/knowledge/:id/connections returns 404 for a nonexistent id', async () => {
    const res = await request(app)
      .get('/api/v1/agents/observatory/knowledge/999999/connections')
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);
    expect(res.status).toBe(404);
  });

  test('GET /observatory/knowledge/:id/connections returns real data for a real id', async () => {
    const k = await AgentKnowledge.create({
      scope: 'global',
      agent_name: null,
      category: 'seo_strategy',
      topic: 't',
      claim: 'c',
      source_type: 'manual_text',
      confidence: 0.5,
      status: 'confirmed',
    });
    const res = await request(app)
      .get(`/api/v1/agents/observatory/knowledge/${k.id}/connections`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.knowledge.id).toBe(k.id);
  });
});
