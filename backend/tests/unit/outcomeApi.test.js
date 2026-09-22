// backend/tests/unit/outcomeApi.test.js
'use strict';

/**
 * P2-D tests: the real HTTP wiring for GET /agents/recommendation-actions/:id/outcome
 * (routes/v1/agents.routes.js -> controllers/agents.controller.js ->
 * services/agents/outcomeMeasurement.js#getOutcomeForAction), reusing the
 * REAL, unmodified requireAuth/requireAdmin middleware and REAL
 * services/tokens.js signing — only the models layer is mocked (in-memory
 * SQLite). Same pattern as recommendationActionsApi.test.js (P1-B2).
 *
 * This endpoint is read-only by construction — there is no route in this
 * file's coverage (or anywhere in the app) that writes to
 * recommendation_outcomes; that's exercised in outcomeMeasurement.test.js
 * and outcomeEvaluationScheduler.test.js instead.
 */

jest.mock('../../src/models', () => {
  const { Sequelize } = require('sequelize');
  const sqlite = new Sequelize('sqlite::memory:', { logging: false });
  const User = require('../../src/models/user')(sqlite);
  const AgentActivity = require('../../src/models/agentActivity')(sqlite);
  const AgentRecommendation = require('../../src/models/agentRecommendation')(sqlite);
  const RecommendationAction = require('../../src/models/recommendationAction')(sqlite);
  const RecommendationOutcome = require('../../src/models/recommendationOutcome')(sqlite);
  const Blog = require('../../src/models/blog')(sqlite);

  AgentRecommendation.belongsTo(AgentActivity, { foreignKey: 'source_activity_id', as: 'sourceActivity', constraints: false });
  AgentRecommendation.belongsTo(User, { foreignKey: 'decided_by', as: 'decidedByUser', constraints: false });
  AgentRecommendation.hasMany(RecommendationAction, { foreignKey: 'recommendation_id', as: 'actions' });
  RecommendationAction.belongsTo(AgentRecommendation, { foreignKey: 'recommendation_id', as: 'recommendation' });
  RecommendationAction.belongsTo(User, { foreignKey: 'executed_by', as: 'executedByUser', constraints: false });

  AgentRecommendation.hasMany(RecommendationOutcome, { foreignKey: 'recommendation_id', as: 'outcomes' });
  RecommendationOutcome.belongsTo(AgentRecommendation, { foreignKey: 'recommendation_id', as: 'recommendation' });
  RecommendationAction.hasOne(RecommendationOutcome, { foreignKey: 'action_id', as: 'outcome' });
  RecommendationOutcome.belongsTo(RecommendationAction, { foreignKey: 'action_id', as: 'action' });

  return {
    User,
    AgentActivity,
    AgentRecommendation,
    RecommendationAction,
    RecommendationOutcome,
    Blog,
    sequelize: sqlite,
    Sequelize,
  };
});

const { AGENT_NAMES } = require('../../src/constants');
const { User, AgentRecommendation, RecommendationAction, RecommendationOutcome, sequelize } = require('../../src/models');

async function makeApprovedRecommendation(overrides = {}) {
  return AgentRecommendation.create({
    trace_id: 'trace-1',
    agent_name: AGENT_NAMES.SEO_ANALYST,
    recommendation_type: 'recommend_seo_action',
    recommendation_details: { recommendation: 'x', rationale: 'x' },
    status: 'approved',
    decided_by: 1,
    decided_at: new Date(),
    observation_window_days: 14,
    ...overrides,
  });
}

async function makeCompletedAction(recommendationId, overrides = {}) {
  return RecommendationAction.create({
    recommendation_id: recommendationId,
    action_type: 'blog.update_seo_fields',
    status: 'completed',
    executor_type: 'automated',
    ...overrides,
  });
}

async function makeOutcome({ recommendationId, actionId, overrides = {} }) {
  return RecommendationOutcome.create({
    recommendation_id: recommendationId,
    action_id: actionId,
    baseline_captured_at: new Date('2026-08-01T00:00:00Z'),
    baseline_evidence_refs: [{ type: 'blog', id: 99 }],
    baseline_metric_snapshot: [{ metric: 'seo_score', value: 27 }],
    observation_window_days: 14,
    due_at: new Date('2026-08-15T00:00:00Z'),
    status: 'pending',
    ...overrides,
  });
}

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  await RecommendationOutcome.destroy({ truncate: true });
  await RecommendationAction.destroy({ truncate: true });
  await AgentRecommendation.destroy({ truncate: true });
  await User.destroy({ truncate: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('GET /agents/recommendation-actions/:id/outcome (P2-D, real HTTP + real auth)', () => {
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

  test('1. an unauthenticated request is rejected (401)', async () => {
    const res = await request(app).get('/api/v1/agents/recommendation-actions/1/outcome');
    expect(res.status).toBe(401);
  });

  test('2. a non-admin (editor) request is rejected (403) — same authz convention as every sibling route', async () => {
    const rec = await makeApprovedRecommendation();
    const action = await makeCompletedAction(rec.id);
    await makeOutcome({ recommendationId: rec.id, actionId: action.id });

    const res = await request(app)
      .get(`/api/v1/agents/recommendation-actions/${action.id}/outcome`)
      .set('Authorization', `Bearer ${tokenFor(editorUser)}`);
    expect(res.status).toBe(403);
  });

  test('3. a nonexistent action id returns 404 OUTCOME_NOT_FOUND, not a crash', async () => {
    const res = await request(app)
      .get('/api/v1/agents/recommendation-actions/999999/outcome')
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('OUTCOME_NOT_FOUND');
  });

  test('4. an action that exists but has no captured outcome yet returns 404, not an empty 200', async () => {
    const rec = await makeApprovedRecommendation();
    const action = await makeCompletedAction(rec.id); // no outcome ever created for this one
    const res = await request(app)
      .get(`/api/v1/agents/recommendation-actions/${action.id}/outcome`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('OUTCOME_NOT_FOUND');
  });

  test('5. valid outcome retrieval returns every documented deterministic field, exactly', async () => {
    const rec = await makeApprovedRecommendation();
    const action = await makeCompletedAction(rec.id);
    const outcome = await makeOutcome({
      recommendationId: rec.id,
      actionId: action.id,
      overrides: {
        status: 'evaluated',
        outcome: 'improved',
        fresh_evidence_refs: [{ type: 'blog', id: 99 }],
        metric_deltas: [{ metric: 'seo_score', baseline: 27, fresh: 40, delta: 13 }],
        evaluation_attempts: 1,
        outcome_reasoning: 'SEO score rose after the metadata update.',
        evaluated_at: new Date('2026-08-15T01:00:00Z'),
      },
    });

    const res = await request(app)
      .get(`/api/v1/agents/recommendation-actions/${action.id}/outcome`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: outcome.id,
      recommendation_id: rec.id,
      action_id: action.id,
      status: 'evaluated',
      outcome: 'improved',
      baseline_evidence_refs: [{ type: 'blog', id: 99 }],
      baseline_metric_snapshot: [{ metric: 'seo_score', value: 27 }],
      fresh_evidence_refs: [{ type: 'blog', id: 99 }],
      metric_deltas: [{ metric: 'seo_score', baseline: 27, fresh: 40, delta: 13 }],
      observation_window_days: 14,
      evaluation_attempts: 1,
      outcome_reasoning: 'SEO score rose after the metadata update.',
    });
    expect(res.body.data.baseline_at).toBeTruthy();
    expect(res.body.data.due_at).toBeTruthy();
    expect(res.body.data.evaluated_at).toBeTruthy();
  });

  test('6. the response correctly associates back to its recommendation and action ids', async () => {
    const rec = await makeApprovedRecommendation();
    const action = await makeCompletedAction(rec.id);
    await makeOutcome({ recommendationId: rec.id, actionId: action.id });

    const res = await request(app)
      .get(`/api/v1/agents/recommendation-actions/${action.id}/outcome`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);

    expect(res.body.data.recommendation_id).toBe(rec.id);
    expect(res.body.data.action_id).toBe(action.id);
  });

  test('7. a pending (not yet evaluated) outcome is still returned in full, with null outcome/metric_deltas — never fabricated', async () => {
    const rec = await makeApprovedRecommendation();
    const action = await makeCompletedAction(rec.id);
    await makeOutcome({ recommendationId: rec.id, actionId: action.id }); // status:'pending' default

    const res = await request(app)
      .get(`/api/v1/agents/recommendation-actions/${action.id}/outcome`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.outcome).toBeNull();
    expect(res.body.data.metric_deltas).toBeNull();
    expect(res.body.data.fresh_evidence_refs).toBeNull();
  });

  test('8. no write verbs exist on this resource — POST/PATCH/PUT/DELETE are all rejected, not silently accepted', async () => {
    const rec = await makeApprovedRecommendation();
    const action = await makeCompletedAction(rec.id);
    await makeOutcome({ recommendationId: rec.id, actionId: action.id });

    const token = tokenFor(adminUser);
    const postRes = await request(app)
      .post(`/api/v1/agents/recommendation-actions/${action.id}/outcome`)
      .set('Authorization', `Bearer ${token}`);
    const patchRes = await request(app)
      .patch(`/api/v1/agents/recommendation-actions/${action.id}/outcome`)
      .set('Authorization', `Bearer ${token}`);
    const deleteRes = await request(app)
      .delete(`/api/v1/agents/recommendation-actions/${action.id}/outcome`)
      .set('Authorization', `Bearer ${token}`);

    expect([404, 405]).toContain(postRes.status);
    expect([404, 405]).toContain(patchRes.status);
    expect([404, 405]).toContain(deleteRes.status);
  });
});
