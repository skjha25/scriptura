// backend/tests/unit/recommendationActionsApi.test.js
'use strict';

/**
 * P1-B2 tests: the real HTTP wiring for recommendation action tracking
 * (routes/v1/agents.routes.js -> controllers/agents.controller.js ->
 * services/agents/recommendationActions.js), reusing the REAL, unmodified
 * requireAuth/requireAdmin middleware and REAL services/tokens.js signing —
 * only the models layer is mocked (in-memory SQLite). Same pattern as
 * recommendationDecisions.test.js's HTTP-layer section (P1-A).
 */

jest.mock('../../src/models', () => {
  const { Sequelize } = require('sequelize');
  const sqlite = new Sequelize('sqlite::memory:', { logging: false });
  const User = require('../../src/models/user')(sqlite);
  const AgentActivity = require('../../src/models/agentActivity')(sqlite);
  const AgentRecommendation = require('../../src/models/agentRecommendation')(sqlite);
  const RecommendationAction = require('../../src/models/recommendationAction')(sqlite);
  const Blog = require('../../src/models/blog')(sqlite);

  AgentRecommendation.belongsTo(AgentActivity, { foreignKey: 'source_activity_id', as: 'sourceActivity', constraints: false });
  AgentRecommendation.belongsTo(User, { foreignKey: 'decided_by', as: 'decidedByUser', constraints: false });
  AgentRecommendation.hasMany(RecommendationAction, { foreignKey: 'recommendation_id', as: 'actions' });
  RecommendationAction.belongsTo(AgentRecommendation, { foreignKey: 'recommendation_id', as: 'recommendation' });
  RecommendationAction.belongsTo(User, { foreignKey: 'executed_by', as: 'executedByUser', constraints: false });

  return { User, AgentActivity, AgentRecommendation, RecommendationAction, Blog, sequelize: sqlite, Sequelize };
});

const { AGENT_NAMES } = require('../../src/constants');
const { User, AgentRecommendation, RecommendationAction, Blog, sequelize } = require('../../src/models');

async function makeApprovedRecommendation(overrides = {}) {
  return AgentRecommendation.create({
    trace_id: 'trace-1',
    agent_name: AGENT_NAMES.SEO_ANALYST,
    recommendation_type: 'recommend_seo_action',
    recommendation_details: { recommendation: 'Add FAQ to Article #42.', rationale: 'x' },
    status: 'approved',
    decided_by: 1,
    decided_at: new Date(),
    ...overrides,
  });
}

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  await RecommendationAction.destroy({ truncate: true });
  await AgentRecommendation.destroy({ truncate: true });
  await User.destroy({ truncate: true });
  await Blog.destroy({ truncate: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('Recommendation action API via real HTTP (supertest + createApp, real auth middleware/tokens)', () => {
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

  test('an unauthenticated create-action request is rejected (401)', async () => {
    const rec = await makeApprovedRecommendation();
    const res = await request(app)
      .post(`/api/v1/agents/recommendations/${rec.id}/actions`)
      .send({ action_type: 'update_blog_content' });
    expect(res.status).toBe(401);
  });

  test('a non-admin (editor) create-action request is rejected (403)', async () => {
    const rec = await makeApprovedRecommendation();
    const res = await request(app)
      .post(`/api/v1/agents/recommendations/${rec.id}/actions`)
      .set('Authorization', `Bearer ${tokenFor(editorUser)}`)
      .send({ action_type: 'update_blog_content' });
    expect(res.status).toBe(403);
  });

  test('full lifecycle: create -> complete over real HTTP, executed_by from authenticated req.user', async () => {
    const rec = await makeApprovedRecommendation();

    const createRes = await request(app)
      .post(`/api/v1/agents/recommendations/${rec.id}/actions`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`)
      .send({ action_type: 'update_blog_content', parameters: { note: 'add FAQ' } });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.status).toBe('pending');
    expect(createRes.body.data.attempt_number).toBe(1);

    const actionId = createRes.body.data.id;

    const completeRes = await request(app)
      .post(`/api/v1/agents/recommendation-actions/${actionId}/complete`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`)
      .send({ result_summary: { note: 'Done' } });

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.status).toBe('completed');
    // executed_by can only ever come from the authenticated session — the
    // request body schema is .strict() and has no executed_by field at all,
    // so a spoof attempt is rejected by validation before the handler even
    // runs (see the 'rejects an executed_by spoof attempt' test below).
    expect(completeRes.body.data.executed_by).toBe(adminUser.id);

    const listRes = await request(app)
      .get(`/api/v1/agents/recommendations/${rec.id}/actions`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0].status).toBe('completed');
  });

  test('creating an action against a not-yet-approved recommendation is rejected over real HTTP (409)', async () => {
    const rec = await AgentRecommendation.create({
      trace_id: 'trace-2',
      agent_name: AGENT_NAMES.SEO_ANALYST,
      recommendation_type: 'recommend_seo_action',
      recommendation_details: { recommendation: 'x', rationale: 'x' },
      status: 'recommended',
    });
    const res = await request(app)
      .post(`/api/v1/agents/recommendations/${rec.id}/actions`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`)
      .send({ action_type: 'update_blog_content' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RECOMMENDATION_NOT_APPROVED');
  });

  test('missing action_type is rejected by validation (422)', async () => {
    const rec = await makeApprovedRecommendation();
    const res = await request(app)
      .post(`/api/v1/agents/recommendations/${rec.id}/actions`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`)
      .send({});
    expect(res.status).toBe(422);
  });

  test('an executed_by spoof attempt in the complete body is rejected by validation, not silently accepted', async () => {
    const rec = await makeApprovedRecommendation();
    const createRes = await request(app)
      .post(`/api/v1/agents/recommendations/${rec.id}/actions`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`)
      .send({ action_type: 'update_blog_content' });

    const res = await request(app)
      .post(`/api/v1/agents/recommendation-actions/${createRes.body.data.id}/complete`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`)
      .send({ executed_by: 999999 });
    expect(res.status).toBe(422); // .strict() schema has no executed_by field — rejected outright, not ignored
  });

  test('fail and cancel round-trip over real HTTP, each a distinct terminal state', async () => {
    const rec = await makeApprovedRecommendation();

    const createRes = await request(app)
      .post(`/api/v1/agents/recommendations/${rec.id}/actions`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`)
      .send({ action_type: 'update_blog_content' });
    const actionId = createRes.body.data.id;

    const failRes = await request(app)
      .post(`/api/v1/agents/recommendation-actions/${actionId}/fail`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`)
      .send({ error: 'target unreachable' });
    expect(failRes.status).toBe(200);
    expect(failRes.body.data.status).toBe('failed');
    expect(failRes.body.data.error).toBe('target unreachable');

    // retry: create-action again now that the prior attempt is terminal
    const retryRes = await request(app)
      .post(`/api/v1/agents/recommendations/${rec.id}/actions`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`)
      .send({ action_type: 'update_blog_content' });
    expect(retryRes.status).toBe(201);
    expect(retryRes.body.data.attempt_number).toBe(2);

    const cancelRes = await request(app)
      .post(`/api/v1/agents/recommendation-actions/${retryRes.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe('cancelled');

    // the recommendation itself is untouched by any of this
    const recRes = await request(app)
      .get('/api/v1/agents/recommendations')
      .query({ status: 'approved' })
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);
    expect(recRes.body.data.find((r) => r.id === rec.id).status).toBe('approved');
  });

  describe('POST /recommendation-actions/:id/execute (P1-B4)', () => {
    async function makeBlog(overrides = {}) {
      return Blog.create({ blog_title: 'P1-B4 HTTP test blog', meta_title: 'Old title', ...overrides });
    }

    test('an unauthenticated execute request is rejected (401)', async () => {
      const res = await request(app).post('/api/v1/agents/recommendation-actions/1/execute');
      expect(res.status).toBe(401);
    });

    test('a non-admin (editor) execute request is rejected (403)', async () => {
      const res = await request(app)
        .post('/api/v1/agents/recommendation-actions/1/execute')
        .set('Authorization', `Bearer ${tokenFor(editorUser)}`);
      expect(res.status).toBe(403);
    });

    test('full lifecycle: create(automated) -> execute -> 200 with result_summary populated', async () => {
      const blog = await makeBlog();
      const rec = await makeApprovedRecommendation({ trace_id: 'trace-execute' });

      const createRes = await request(app)
        .post(`/api/v1/agents/recommendations/${rec.id}/actions`)
        .set('Authorization', `Bearer ${tokenFor(adminUser)}`)
        .send({ action_type: 'blog.update_seo_fields', parameters: { blog_id: blog.id, meta_title: 'New title' } });
      expect(createRes.status).toBe(201);
      expect(createRes.body.data.executor_type).toBe('automated');

      const executeRes = await request(app)
        .post(`/api/v1/agents/recommendation-actions/${createRes.body.data.id}/execute`)
        .set('Authorization', `Bearer ${tokenFor(adminUser)}`);
      expect(executeRes.status).toBe(200);
      expect(executeRes.body.data.status).toBe('completed');
      expect(executeRes.body.data.executed_by).toBe(adminUser.id);
      expect(executeRes.body.data.result_summary).toMatchObject({
        blog_id: blog.id,
        before: { meta_title: 'Old title' },
        after: { meta_title: 'New title' },
      });

      const reloadedBlog = await Blog.findByPk(blog.id);
      expect(reloadedBlog.meta_title).toBe('New title');
    });

    test('execute on a manual action falls through unchanged (409 ACTION_NOT_AUTOMATED)', async () => {
      const rec = await makeApprovedRecommendation();
      const createRes = await request(app)
        .post(`/api/v1/agents/recommendations/${rec.id}/actions`)
        .set('Authorization', `Bearer ${tokenFor(adminUser)}`)
        .send({ action_type: 'update_blog_content' });
      expect(createRes.body.data.executor_type).toBe('manual');

      const executeRes = await request(app)
        .post(`/api/v1/agents/recommendation-actions/${createRes.body.data.id}/execute`)
        .set('Authorization', `Bearer ${tokenFor(adminUser)}`);
      expect(executeRes.status).toBe(409);
      expect(executeRes.body.error.code).toBe('ACTION_NOT_AUTOMATED');
    });

    test('execute on a non-pending action returns 409', async () => {
      const blog = await makeBlog();
      const rec = await makeApprovedRecommendation();
      const createRes = await request(app)
        .post(`/api/v1/agents/recommendations/${rec.id}/actions`)
        .set('Authorization', `Bearer ${tokenFor(adminUser)}`)
        .send({ action_type: 'blog.update_seo_fields', parameters: { blog_id: blog.id, meta_title: 'x' } });

      await request(app)
        .post(`/api/v1/agents/recommendation-actions/${createRes.body.data.id}/execute`)
        .set('Authorization', `Bearer ${tokenFor(adminUser)}`);

      const secondExecuteRes = await request(app)
        .post(`/api/v1/agents/recommendation-actions/${createRes.body.data.id}/execute`)
        .set('Authorization', `Bearer ${tokenFor(adminUser)}`);
      expect(secondExecuteRes.status).toBe(409);
      expect(secondExecuteRes.body.error.code).toBe('ACTION_NOT_PENDING');
    });
  });
});
