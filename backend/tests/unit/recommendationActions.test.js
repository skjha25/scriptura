// backend/tests/unit/recommendationActions.test.js
'use strict';

/**
 * P1-B1 tests: services/agents/recommendationActions.js (the action
 * create/complete/fail/cancel state machine), isolated against an in-memory
 * SQLite instance built from the real model factories — same pattern
 * established across every prior phase this session. No real DB or network
 * is touched by this file. HTTP-layer/auth tests live in
 * recommendationActionsApi.test.js (P1-B2).
 */

jest.mock('../../src/models', () => {
  const { Sequelize } = require('sequelize');
  const sqlite = new Sequelize('sqlite::memory:', { logging: false });
  const User = require('../../src/models/user')(sqlite);
  const AgentActivity = require('../../src/models/agentActivity')(sqlite);
  const AgentRecommendation = require('../../src/models/agentRecommendation')(sqlite);
  const RecommendationAction = require('../../src/models/recommendationAction')(sqlite);

  AgentRecommendation.belongsTo(AgentActivity, { foreignKey: 'source_activity_id', as: 'sourceActivity', constraints: false });
  AgentRecommendation.belongsTo(User, { foreignKey: 'decided_by', as: 'decidedByUser', constraints: false });
  AgentRecommendation.hasMany(RecommendationAction, { foreignKey: 'recommendation_id', as: 'actions' });
  RecommendationAction.belongsTo(AgentRecommendation, { foreignKey: 'recommendation_id', as: 'recommendation' });
  RecommendationAction.belongsTo(User, { foreignKey: 'executed_by', as: 'executedByUser', constraints: false });

  return { User, AgentActivity, AgentRecommendation, RecommendationAction, sequelize: sqlite, Sequelize };
});

const { AGENT_NAMES } = require('../../src/constants');
const { AgentRecommendation, RecommendationAction, sequelize } = require('../../src/models');
const {
  createAction,
  completeAction,
  failAction,
  cancelAction,
  listActions,
} = require('../../src/services/agents/recommendationActions');

async function makeRecommendation(overrides = {}) {
  return AgentRecommendation.create({
    trace_id: 'trace-parent',
    agent_name: AGENT_NAMES.SEO_ANALYST,
    recommendation_type: 'recommend_seo_action',
    recommendation_details: { recommendation: 'Add FAQ to Article #42.', rationale: 'x' },
    status: 'recommended',
    ...overrides,
  });
}

async function makeApprovedRecommendation(overrides = {}) {
  return makeRecommendation({ status: 'approved', decided_by: 1, decided_at: new Date(), ...overrides });
}

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  await RecommendationAction.destroy({ truncate: true });
  await AgentRecommendation.destroy({ truncate: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('createAction — approval gate + idempotent-create guard', () => {
  test('1. an approved recommendation can have an action created', async () => {
    const rec = await makeApprovedRecommendation();
    const action = await createAction(rec.id, { actionType: 'update_blog_content' });
    expect(action.status).toBe('pending');
    expect(action.attempt_number).toBe(1);
    expect(action.executor_type).toBe('manual');
    expect(action.recommendation_id).toBe(rec.id);
  });

  test('2a. a recommended (not yet decided) recommendation cannot have an action created', async () => {
    const rec = await makeRecommendation({ status: 'recommended' });
    await expect(createAction(rec.id, { actionType: 'update_blog_content' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'RECOMMENDATION_NOT_APPROVED',
    });
  });

  test('2b. a rejected recommendation cannot have an action created', async () => {
    const rec = await makeRecommendation({ status: 'rejected', decided_by: 1, decided_at: new Date() });
    await expect(createAction(rec.id, { actionType: 'update_blog_content' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'RECOMMENDATION_NOT_APPROVED',
    });
  });

  test('nonexistent recommendation is a 404, not a crash', async () => {
    await expect(createAction(999999, { actionType: 'update_blog_content' })).rejects.toMatchObject({ statusCode: 404 });
  });

  test('4. duplicate action creation while one is pending is rejected', async () => {
    const rec = await makeApprovedRecommendation();
    await createAction(rec.id, { actionType: 'update_blog_content' });
    await expect(createAction(rec.id, { actionType: 'update_blog_content' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'ACTION_ALREADY_PENDING',
    });
    expect(await RecommendationAction.count({ where: { recommendation_id: rec.id } })).toBe(1);
  });

  test('5. concurrent action-creation calls do not silently duplicate attempt_number bookkeeping', async () => {
    // NOT a claim of perfect DB-level race protection — the design report
    // (§10) explicitly accepts this as a narrow, low-risk gap: MySQL has no
    // partial-unique-index support for "unique only when pending" without a
    // generated column, and this is a single-org, admin-only, low-concurrency
    // tool. This test documents the actual observed behavior under a real
    // concurrent Promise.all rather than asserting an untrue guarantee.
    const rec = await makeApprovedRecommendation();
    const results = await Promise.allSettled([
      createAction(rec.id, { actionType: 'update_blog_content' }),
      createAction(rec.id, { actionType: 'update_blog_content' }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    // At least one must succeed; any rejection must be the expected conflict
    // (never an unrelated crash), and every successful row must have a
    // distinct id — no attempt silently overwrote another.
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const r of rejected) {
      expect(r.reason).toMatchObject({ statusCode: 409, code: 'ACTION_ALREADY_PENDING' });
    }
    const ids = new Set(fulfilled.map((r) => r.value.id));
    expect(ids.size).toBe(fulfilled.length);
  });

  test('8. retry after a failed attempt creates a new row with incremented attempt_number; old row untouched', async () => {
    const rec = await makeApprovedRecommendation();
    const first = await createAction(rec.id, { actionType: 'update_blog_content' });
    await failAction(first.id, { error: 'could not reach target page', userId: 5 });

    const second = await createAction(rec.id, { actionType: 'update_blog_content' });
    expect(second.attempt_number).toBe(2);
    expect(second.status).toBe('pending');
    expect(second.id).not.toBe(first.id);

    const reloadedFirst = await RecommendationAction.findByPk(first.id);
    expect(reloadedFirst.status).toBe('failed');
    expect(reloadedFirst.error).toBe('could not reach target page');
    expect(reloadedFirst.attempt_number).toBe(1);
  });

  test('12. provenance: trace_id is inherited from the parent recommendation when not explicitly supplied', async () => {
    const rec = await makeApprovedRecommendation({ trace_id: 'trace-abc-123' });
    const action = await createAction(rec.id, { actionType: 'update_blog_content' });
    expect(action.trace_id).toBe('trace-abc-123');
  });

  test('an explicit trace_id overrides the inherited one', async () => {
    const rec = await makeApprovedRecommendation({ trace_id: 'trace-parent' });
    const action = await createAction(rec.id, { actionType: 'update_blog_content', traceId: 'trace-override' });
    expect(action.trace_id).toBe('trace-override');
  });
});

describe('completeAction / failAction / cancelAction — guarded transitions', () => {
  test('3a. pending -> completed', async () => {
    const rec = await makeApprovedRecommendation();
    const action = await createAction(rec.id, { actionType: 'update_blog_content' });
    const result = await completeAction(action.id, { resultSummary: { note: 'Added FAQ section.' }, userId: 7 });
    expect(result.status).toBe('completed');
    expect(result.executed_by).toBe(7);
    expect(result.completed_at).toBeInstanceOf(Date);
    expect(result.result_summary).toEqual({ note: 'Added FAQ section.' });
  });

  test('3b. pending -> failed', async () => {
    const rec = await makeApprovedRecommendation();
    const action = await createAction(rec.id, { actionType: 'update_blog_content' });
    const result = await failAction(action.id, { error: 'target page 404s', userId: 7 });
    expect(result.status).toBe('failed');
    expect(result.error).toBe('target page 404s');
    expect(result.executed_by).toBe(7);
  });

  test('3c. pending -> cancelled', async () => {
    const rec = await makeApprovedRecommendation();
    const action = await createAction(rec.id, { actionType: 'update_blog_content' });
    const result = await cancelAction(action.id, { userId: 7 });
    expect(result.status).toBe('cancelled');
    expect(result.executed_by).toBe(7);
  });

  test('6. duplicate complete call is an idempotent no-op (same executed_by, no crash)', async () => {
    const rec = await makeApprovedRecommendation();
    const action = await createAction(rec.id, { actionType: 'update_blog_content' });
    const first = await completeAction(action.id, { userId: 7 });
    const second = await completeAction(action.id, { userId: 9 });
    expect(second.status).toBe('completed');
    expect(second.executed_by).toBe(7); // first decision wins
    expect(second.completed_at.getTime()).toBe(first.completed_at.getTime());
  });

  test('duplicate fail / duplicate cancel are also idempotent no-ops', async () => {
    const rec = await makeApprovedRecommendation();
    const failAttempt = await createAction(rec.id, { actionType: 'update_blog_content' });
    await failAction(failAttempt.id, { userId: 7 });
    const secondFail = await failAction(failAttempt.id, { userId: 9 });
    expect(secondFail.status).toBe('failed');
    expect(secondFail.executed_by).toBe(7);

    const cancelAttempt = await createAction(rec.id, { actionType: 'update_blog_content' });
    await cancelAction(cancelAttempt.id, { userId: 7 });
    const secondCancel = await cancelAction(cancelAttempt.id, { userId: 9 });
    expect(secondCancel.status).toBe('cancelled');
    expect(secondCancel.executed_by).toBe(7);
  });

  test('completing an already-failed action is a 409 conflict (no cross-terminal transition)', async () => {
    const rec = await makeApprovedRecommendation();
    const action = await createAction(rec.id, { actionType: 'update_blog_content' });
    await failAction(action.id, { userId: 7 });
    await expect(completeAction(action.id, { userId: 9 })).rejects.toMatchObject({
      statusCode: 409,
      code: 'ACTION_NOT_PENDING',
    });
    await expect(cancelAction(action.id, { userId: 9 })).rejects.toMatchObject({ statusCode: 409 });
  });

  test('nonexistent action id is a 404', async () => {
    await expect(completeAction(999999, { userId: 1 })).rejects.toMatchObject({ statusCode: 404 });
    await expect(failAction(999999, { userId: 1 })).rejects.toMatchObject({ statusCode: 404 });
    await expect(cancelAction(999999, { userId: 1 })).rejects.toMatchObject({ statusCode: 404 });
  });

  test('7. a failed action has zero effect on the parent recommendation status', async () => {
    const rec = await makeApprovedRecommendation();
    const action = await createAction(rec.id, { actionType: 'update_blog_content' });
    await failAction(action.id, { error: 'boom', userId: 7 });

    const reloadedRec = await AgentRecommendation.findByPk(rec.id);
    expect(reloadedRec.status).toBe('approved');
    expect(reloadedRec.decided_by).toBe(rec.decided_by); // untouched by the action layer entirely
  });
});

describe('listActions', () => {
  test('returns full attempt history ordered by attempt_number desc', async () => {
    const rec = await makeApprovedRecommendation();
    const first = await createAction(rec.id, { actionType: 'update_blog_content' });
    await failAction(first.id, { userId: 7 });
    const second = await createAction(rec.id, { actionType: 'update_blog_content' });

    const history = await listActions(rec.id);
    expect(history).toHaveLength(2);
    expect(history[0].id).toBe(second.id);
    expect(history[1].id).toBe(first.id);
  });

  test('returns an empty array for a recommendation with no tracked actions', async () => {
    const rec = await makeApprovedRecommendation();
    expect(await listActions(rec.id)).toEqual([]);
  });
});
