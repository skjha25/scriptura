// backend/tests/unit/recommendationDecisions.test.js
'use strict';

/**
 * P1-A tests: services/agents/recommendationDecisions.js (the guarded
 * approve/reject state machine) plus the real HTTP wiring
 * (routes/v1/agents.routes.js -> controllers/agents.controller.js), reusing
 * the REAL, unmodified requireAuth/requireAdmin middleware and the REAL
 * services/tokens.js signing/verification — only the models layer is mocked
 * (in-memory SQLite), matching this session's established isolation pattern.
 * No real DB or network is touched by this file.
 */

jest.mock('../../src/models', () => {
  const { Sequelize } = require('sequelize');
  const sqlite = new Sequelize('sqlite::memory:', { logging: false });
  const User = require('../../src/models/user')(sqlite);
  const AgentRecommendation = require('../../src/models/agentRecommendation')(sqlite);
  const AgentActivity = require('../../src/models/agentActivity')(sqlite);
  AgentRecommendation.belongsTo(AgentActivity, { foreignKey: 'source_activity_id', as: 'sourceActivity', constraints: false });
  AgentRecommendation.belongsTo(User, { foreignKey: 'decided_by', as: 'decidedByUser', constraints: false });
  return { User, AgentRecommendation, AgentActivity, sequelize: sqlite, Sequelize };
});

const { AGENT_NAMES } = require('../../src/constants');
const { User, AgentRecommendation, sequelize } = require('../../src/models');
const {
  approveRecommendation,
  rejectRecommendation,
  listRecommendations,
  bulkApproveRecommendations,
  bulkRejectRecommendations,
} = require('../../src/services/agents/recommendationDecisions');

async function makeRecommendation(overrides = {}) {
  return AgentRecommendation.create({
    trace_id: 'trace-1',
    agent_name: AGENT_NAMES.SEO_ANALYST,
    recommendation_type: 'recommend_seo_action',
    recommendation_details: { recommendation: 'Add FAQ to Article #42.', rationale: 'x' },
    status: 'recommended',
    ...overrides,
  });
}

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  await AgentRecommendation.destroy({ truncate: true });
  await User.destroy({ truncate: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('recommendationDecisions service — state transitions', () => {
  test('1. recommended -> approved', async () => {
    const row = await makeRecommendation();
    const result = await approveRecommendation(row.id, { userId: 7 });
    expect(result.status).toBe('approved');
  });

  test('2. recommended -> rejected', async () => {
    const row = await makeRecommendation();
    const result = await rejectRecommendation(row.id, { userId: 7 });
    expect(result.status).toBe('rejected');
  });

  test('3. approve already-approved is idempotent (no error, same state, no duplicate)', async () => {
    const row = await makeRecommendation();
    await approveRecommendation(row.id, { userId: 7 });
    const second = await approveRecommendation(row.id, { userId: 9 });
    expect(second.status).toBe('approved');
    expect(second.decided_by).toBe(7); // first decision wins — second call is a true no-op, not a re-decision
    expect(await AgentRecommendation.count()).toBe(1);
  });

  test('4. reject already-rejected is idempotent', async () => {
    const row = await makeRecommendation();
    await rejectRecommendation(row.id, { userId: 7 });
    const second = await rejectRecommendation(row.id, { userId: 9 });
    expect(second.status).toBe('rejected');
    expect(second.decided_by).toBe(7);
    expect(await AgentRecommendation.count()).toBe(1);
  });

  test('5. approve an already-rejected recommendation throws a 409 conflict', async () => {
    const row = await makeRecommendation();
    await rejectRecommendation(row.id, { userId: 7 });
    await expect(approveRecommendation(row.id, { userId: 9 })).rejects.toMatchObject({ statusCode: 409 });
    const reloaded = await AgentRecommendation.findByPk(row.id);
    expect(reloaded.status).toBe('rejected'); // unchanged by the rejected attempt
  });

  test('6. reject an already-approved recommendation throws a 409 conflict (no reopen mechanism)', async () => {
    const row = await makeRecommendation();
    await approveRecommendation(row.id, { userId: 7 });
    await expect(rejectRecommendation(row.id, { userId: 9 })).rejects.toMatchObject({ statusCode: 409 });
    const reloaded = await AgentRecommendation.findByPk(row.id);
    expect(reloaded.status).toBe('approved');
  });

  test('8. decided_at is written on a real transition', async () => {
    const row = await makeRecommendation();
    const before = Date.now();
    const result = await approveRecommendation(row.id, { userId: 7 });
    expect(result.decided_at).toBeInstanceOf(Date);
    expect(result.decided_at.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  test('11. a nonexistent recommendation id is handled as 404, not a crash', async () => {
    await expect(approveRecommendation(999999, { userId: 7 })).rejects.toMatchObject({ statusCode: 404 });
    await expect(rejectRecommendation(999999, { userId: 7 })).rejects.toMatchObject({ statusCode: 404 });
  });

  test('12. existing recommendation data (trace_id, source_activity_id, recommendation_details) remains intact through a decision', async () => {
    const row = await makeRecommendation({ trace_id: 'trace-preserve', source_activity_id: 555 });
    const result = await approveRecommendation(row.id, { userId: 7 });
    expect(result.trace_id).toBe('trace-preserve');
    expect(result.source_activity_id).toBe(555);
    expect(result.recommendation_details).toEqual({ recommendation: 'Add FAQ to Article #42.', rationale: 'x' });
  });

  test('listRecommendations defaults to nothing extra and filters by status', async () => {
    await makeRecommendation();
    const approvedRow = await makeRecommendation();
    await approveRecommendation(approvedRow.id, { userId: 1 });

    const pending = await listRecommendations({ status: 'recommended' });
    expect(pending).toHaveLength(1);
    const approved = await listRecommendations({ status: 'approved' });
    expect(approved).toHaveLength(1);
  });
});

describe('bulk approve/reject — acts on every pending row, not just a loaded page', () => {
  test('bulkRejectRecommendations transitions every recommended row to rejected', async () => {
    const rows = await Promise.all([makeRecommendation(), makeRecommendation(), makeRecommendation()]);
    const result = await bulkRejectRecommendations({ userId: 7 });
    expect(result.updated).toBe(3);

    const reloaded = await Promise.all(rows.map((r) => AgentRecommendation.findByPk(r.id)));
    reloaded.forEach((r) => {
      expect(r.status).toBe('rejected');
      expect(r.decided_by).toBe(7);
    });
    // A subsequent list of the pending view is empty — a bulk-rejected row
    // does not reappear as "recommended" on the next load/refresh.
    expect(await listRecommendations({ status: 'recommended' })).toHaveLength(0);
  });

  test('bulkApproveRecommendations transitions every recommended row to approved', async () => {
    await Promise.all([makeRecommendation(), makeRecommendation()]);
    const result = await bulkApproveRecommendations({ userId: 9 });
    expect(result.updated).toBe(2);
    expect(await listRecommendations({ status: 'recommended' })).toHaveLength(0);
    expect(await listRecommendations({ status: 'approved' })).toHaveLength(2);
  });

  test('bulk actions never touch a row a human already decided', async () => {
    const alreadyApproved = await makeRecommendation();
    await approveRecommendation(alreadyApproved.id, { userId: 1 });
    const pendingRow = await makeRecommendation();

    const result = await bulkRejectRecommendations({ userId: 7 });
    expect(result.updated).toBe(1); // only the still-pending row

    const reloadedApproved = await AgentRecommendation.findByPk(alreadyApproved.id);
    expect(reloadedApproved.status).toBe('approved'); // untouched
    expect(reloadedApproved.decided_by).toBe(1); // original decider preserved

    const reloadedPending = await AgentRecommendation.findByPk(pendingRow.id);
    expect(reloadedPending.status).toBe('rejected');
  });

  test('bulk reject with nothing pending is a harmless no-op', async () => {
    const result = await bulkRejectRecommendations({ userId: 7 });
    expect(result.updated).toBe(0);
  });
});

describe('Approval API via real HTTP (supertest + createApp, real auth middleware/tokens)', () => {
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

  test('9. an unauthenticated request is rejected (401)', async () => {
    const row = await makeRecommendation();
    const res = await request(app).post(`/api/v1/agents/recommendations/${row.id}/approve`);
    expect(res.status).toBe(401);
  });

  test('10. a non-admin (editor) request is rejected (403)', async () => {
    const row = await makeRecommendation();
    const res = await request(app)
      .post(`/api/v1/agents/recommendations/${row.id}/approve`)
      .set('Authorization', `Bearer ${tokenFor(editorUser)}`);
    expect(res.status).toBe(403);
  });

  test('7. decided_by comes from the authenticated req.user, never from the request body', async () => {
    const row = await makeRecommendation();
    const res = await request(app)
      .post(`/api/v1/agents/recommendations/${row.id}/approve`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`)
      .send({ decided_by: 999999 }); // attempted spoof — must be ignored

    expect(res.status).toBe(200);
    expect(res.body.data.decided_by).toBe(adminUser.id);
    expect(res.body.data.decided_by).not.toBe(999999);
  });

  test('a real approve -> reject conflict round-trips correctly over HTTP', async () => {
    const row = await makeRecommendation();
    const approveRes = await request(app)
      .post(`/api/v1/agents/recommendations/${row.id}/approve`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.status).toBe('approved');

    const rejectRes = await request(app)
      .post(`/api/v1/agents/recommendations/${row.id}/reject`)
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);
    expect(rejectRes.status).toBe(409);
  });

  test('GET /agents/recommendations defaults to the pending view', async () => {
    await makeRecommendation();
    const res = await request(app)
      .get('/api/v1/agents/recommendations')
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('recommended');
  });

  test('POST /agents/recommendations/bulk-reject rejects every pending row, non-admin is refused', async () => {
    await Promise.all([makeRecommendation(), makeRecommendation()]);

    const editorRes = await request(app)
      .post('/api/v1/agents/recommendations/bulk-reject')
      .set('Authorization', `Bearer ${tokenFor(editorUser)}`);
    expect(editorRes.status).toBe(403);

    const res = await request(app)
      .post('/api/v1/agents/recommendations/bulk-reject')
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(2);

    const list = await request(app)
      .get('/api/v1/agents/recommendations')
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);
    expect(list.body.data).toHaveLength(0); // gone from the pending view after refresh
  });

  test('POST /agents/recommendations/bulk-approve approves every pending row', async () => {
    await makeRecommendation();
    const res = await request(app)
      .post('/api/v1/agents/recommendations/bulk-approve')
      .set('Authorization', `Bearer ${tokenFor(adminUser)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(1);
  });
});
