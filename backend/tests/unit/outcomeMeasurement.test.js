// backend/tests/unit/outcomeMeasurement.test.js
'use strict';

/**
 * P2-B tests: services/agents/outcomeMeasurement.js (baseline capture) and
 * its integration into recommendationActions.js's completeAction()/
 * executeAction() success paths. Isolated against an in-memory SQLite
 * instance built from the real model factories, same pattern as
 * recommendationActions.test.js/actionExecutors.test.js. serp.js and gsc.js
 * are mocked at the module boundary this file actually calls — no real
 * SerpAPI/Google network call, ever, historically or otherwise.
 */

jest.mock('../../src/services/serp', () => ({
  isEnabled: jest.fn(() => false),
  checkRank: jest.fn(),
  normalizeKeyword: jest.fn((kw) => String(kw || '').trim().toLowerCase().replace(/\s+/g, ' ')),
}));

jest.mock('../../src/services/gsc', () => ({
  isEnabled: jest.fn(() => false),
  lastNDays: jest.fn(() => ({ start: '2026-08-10', end: '2026-08-12' })),
  fetchSearchAnalytics: jest.fn(),
}));

jest.mock('../../src/models', () => {
  const { Sequelize } = require('sequelize');
  const sqlite = new Sequelize('sqlite::memory:', { logging: false });
  const User = require('../../src/models/user')(sqlite);
  const AgentActivity = require('../../src/models/agentActivity')(sqlite);
  const AgentRecommendation = require('../../src/models/agentRecommendation')(sqlite);
  const RecommendationAction = require('../../src/models/recommendationAction')(sqlite);
  const RecommendationOutcome = require('../../src/models/recommendationOutcome')(sqlite);
  const Blog = require('../../src/models/blog')(sqlite);
  const SerpSnapshot = require('../../src/models/serpSnapshot')(sqlite);

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
    SerpSnapshot,
    sequelize: sqlite,
    Sequelize,
  };
});

const { AGENT_NAMES } = require('../../src/constants');
const serp = require('../../src/services/serp');
const gsc = require('../../src/services/gsc');
const {
  AgentRecommendation,
  RecommendationAction,
  RecommendationOutcome,
  Blog,
  SerpSnapshot,
  sequelize,
} = require('../../src/models');
const outcomeMeasurement = require('../../src/services/agents/outcomeMeasurement');
const {
  createAction,
  completeAction,
  failAction,
  executeAction,
} = require('../../src/services/agents/recommendationActions');

async function makeBlog(overrides = {}) {
  return Blog.create({
    blog_title: 'P2-B test blog',
    meta_title: 'Old title',
    seo_score: 62,
    aeo_score: 40,
    geo_score: 35,
    word_count: 900,
    content_blocks: [{ id: 'block-1', type: 'paragraph', data: { text: 'Body.' } }],
    ...overrides,
  });
}

async function makeApprovedRecommendation(overrides = {}) {
  return AgentRecommendation.create({
    trace_id: 'trace-parent',
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

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  jest.clearAllMocks();
  serp.isEnabled.mockReturnValue(false);
  gsc.isEnabled.mockReturnValue(false);
  await RecommendationOutcome.destroy({ truncate: true });
  await RecommendationAction.destroy({ truncate: true });
  await AgentRecommendation.destroy({ truncate: true });
  await Blog.destroy({ truncate: true });
  await SerpSnapshot.destroy({ truncate: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('captureBaseline — deterministic evidence only', () => {
  test('blog score baseline resolves from the Blog row itself, no external call needed', async () => {
    const blog = await makeBlog();
    const rec = await makeApprovedRecommendation({ target_ref: { blog_id: blog.id } });
    const action = await RecommendationAction.create({
      recommendation_id: rec.id,
      action_type: 'blog.update_seo_fields',
      status: 'completed',
      executor_type: 'automated',
      result_summary: { blog_id: blog.id, before: {}, after: {} },
    });

    const outcome = await outcomeMeasurement.captureBaseline({ recommendation: rec, action });

    // The Blog model's own beforeSave hook recomputes seo_score/aeo_score/
    // geo_score/word_count from content_blocks on every save — reload to
    // assert against the real, current deterministic values rather than
    // whatever this test happened to pass into .create(), which is exactly
    // what "reuse existing deterministic sources" means in practice.
    const reloadedBlog = await Blog.findByPk(blog.id);

    expect(outcome).not.toBeNull();
    expect(outcome.status).toBe('pending');
    expect(outcome.baseline_evidence_refs).toEqual([{ type: 'blog', id: blog.id }]);
    expect(outcome.baseline_metric_snapshot).toEqual(
      expect.arrayContaining([
        { metric: 'seo_score', value: reloadedBlog.seo_score },
        { metric: 'aeo_score', value: reloadedBlog.aeo_score },
        { metric: 'geo_score', value: reloadedBlog.geo_score },
        { metric: 'word_count', value: reloadedBlog.word_count },
      ])
    );
    // Deterministic only — nothing here is LLM-authored.
    const reloadedOutcome = await RecommendationOutcome.findByPk(outcome.id);
    expect(reloadedOutcome.outcome).toBeNull();
    expect(reloadedOutcome.metric_deltas).toBeNull();
    expect(reloadedOutcome.outcome_reasoning).toBeNull();
  });

  test('SERP evidence is referenced correctly: pointer to the real persisted snapshot, exact observed position (not an interpretation)', async () => {
    serp.isEnabled.mockReturnValue(true);
    serp.checkRank.mockResolvedValue({ position: 5, domain: 'divinetalk.in', keyword: 'astrology consultation' });
    const snapshot = await SerpSnapshot.create({
      keyword: 'astrology consultation',
      normalized_keyword: 'astrology consultation',
      location: 'in',
      language: 'en',
      device: 'desktop',
      provider: 'serpapi',
      searched_at: new Date(),
      source_function: 'checkRank',
    });

    const rec = await makeApprovedRecommendation({ target_ref: { keyword: 'astrology consultation' } });
    const action = await RecommendationAction.create({
      recommendation_id: rec.id,
      action_type: 'update_blog_content',
      status: 'completed',
      executor_type: 'manual',
    });

    const outcome = await outcomeMeasurement.captureBaseline({ recommendation: rec, action });

    expect(outcome).not.toBeNull();
    expect(outcome.baseline_evidence_refs).toEqual([{ type: 'serp_snapshot', id: snapshot.id }]);
    expect(outcome.baseline_metric_snapshot).toEqual([{ metric: 'serp_position', value: 5 }]);
    // Reuses the existing INTERNAL_HOSTS[0] constant, never a duplicate domain literal.
    expect(serp.checkRank).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: 'astrology consultation', domain: 'divinetalk.in' })
    );
  });

  test('GSC evidence is referenced correctly when available: pointer to the snapshot, aggregated real numbers for the target page', async () => {
    gsc.isEnabled.mockReturnValue(true);
    gsc.fetchSearchAnalytics.mockResolvedValue({
      id: 77,
      rows: [
        { page: 'https://divinetalk.in/astrology', query: 'a', clicks: 10, impressions: 100, ctr: 0.1, position: 4 },
        { page: 'https://divinetalk.in/astrology', query: 'b', clicks: 5, impressions: 50, ctr: 0.1, position: 6 },
        { page: 'https://divinetalk.in/other-page', query: 'c', clicks: 99, impressions: 999, ctr: 0.1, position: 1 },
      ],
    });

    const rec = await makeApprovedRecommendation({ target_ref: { page_url: 'https://divinetalk.in/astrology' } });
    const action = await RecommendationAction.create({
      recommendation_id: rec.id,
      action_type: 'update_blog_content',
      status: 'completed',
      executor_type: 'manual',
    });

    const outcome = await outcomeMeasurement.captureBaseline({ recommendation: rec, action });

    expect(outcome).not.toBeNull();
    expect(outcome.baseline_evidence_refs).toEqual([{ type: 'gsc_snapshot', id: 77 }]);
    // Only the two rows for the target page are aggregated — the unrelated page's 99 clicks never leak in.
    const metrics = Object.fromEntries(outcome.baseline_metric_snapshot.map((m) => [m.metric, m.value]));
    expect(metrics.gsc_clicks).toBe(15);
    expect(metrics.gsc_impressions).toBe(150);
    expect(metrics.gsc_ctr).toBeCloseTo(0.1);
    expect(metrics.gsc_position).toBeCloseTo((4 * 100 + 6 * 50) / 150);
  });

  test('missing GSC data (no rows match the target page) does not fabricate a baseline for that source', async () => {
    gsc.isEnabled.mockReturnValue(true);
    gsc.fetchSearchAnalytics.mockResolvedValue({
      id: 78,
      rows: [{ page: 'https://divinetalk.in/unrelated', query: 'x', clicks: 1, impressions: 1, ctr: 1, position: 1 }],
    });

    const rec = await makeApprovedRecommendation({ target_ref: { page_url: 'https://divinetalk.in/no-traffic-yet' } });
    const action = await RecommendationAction.create({
      recommendation_id: rec.id,
      action_type: 'update_blog_content',
      status: 'completed',
      executor_type: 'manual',
    });

    const outcome = await outcomeMeasurement.captureBaseline({ recommendation: rec, action });

    // No blog target, SERP disabled, GSC resolved nothing for this page —
    // nothing at all is resolvable, so no row is created (not a fabricated empty one).
    expect(outcome).toBeNull();
  });

  test('missing SERP data (rank checked but no snapshot to point at) does not fabricate a baseline for that source', async () => {
    serp.isEnabled.mockReturnValue(true);
    serp.checkRank.mockResolvedValue({ position: 12 });
    // Deliberately no SerpSnapshot row seeded — simulates checkRank's own
    // internal best-effort persistence having failed.

    const rec = await makeApprovedRecommendation({ target_ref: { keyword: 'no snapshot for this one' } });
    const action = await RecommendationAction.create({
      recommendation_id: rec.id,
      action_type: 'update_blog_content',
      status: 'completed',
      executor_type: 'manual',
    });

    const outcome = await outcomeMeasurement.captureBaseline({ recommendation: rec, action });

    expect(outcome).toBeNull();
  });

  test('a SERP/GSC failure never propagates — logged and skipped, other sources still resolve', async () => {
    const blog = await makeBlog();
    serp.isEnabled.mockReturnValue(true);
    serp.checkRank.mockRejectedValue(new Error('SerpAPI quota exceeded'));

    const rec = await makeApprovedRecommendation({ target_ref: { blog_id: blog.id, keyword: 'astrology' } });
    const action = await RecommendationAction.create({
      recommendation_id: rec.id,
      action_type: 'blog.update_seo_fields',
      status: 'completed',
      executor_type: 'automated',
      result_summary: { blog_id: blog.id },
    });

    const outcome = await outcomeMeasurement.captureBaseline({ recommendation: rec, action });

    expect(outcome).not.toBeNull(); // blog score still resolved despite the SERP failure
    expect(outcome.baseline_evidence_refs).toEqual([{ type: 'blog', id: blog.id }]);
  });
});

describe('captureBaseline — idempotency', () => {
  test('a second call for the same action returns the existing row and never re-calls SERP/GSC', async () => {
    serp.isEnabled.mockReturnValue(true);
    serp.checkRank.mockResolvedValue({ position: 3 });
    const snapshot = await SerpSnapshot.create({
      keyword: 'kw', normalized_keyword: 'kw', location: 'in', language: 'en', device: 'desktop',
      provider: 'serpapi', searched_at: new Date(), source_function: 'checkRank',
    });

    const rec = await makeApprovedRecommendation({ target_ref: { keyword: 'kw' } });
    const action = await RecommendationAction.create({
      recommendation_id: rec.id, action_type: 'update_blog_content', status: 'completed', executor_type: 'manual',
    });

    const first = await outcomeMeasurement.captureBaseline({ recommendation: rec, action });
    const second = await outcomeMeasurement.captureBaseline({ recommendation: rec, action });

    expect(second.id).toBe(first.id);
    expect(await RecommendationOutcome.count({ where: { action_id: action.id } })).toBe(1);
    expect(serp.checkRank).toHaveBeenCalledTimes(1); // never re-fetched on the retried call
    void snapshot;
  });
});

describe('completeAction/executeAction integration — P2-B hook', () => {
  test('1. successful automated action creates exactly one outcome', async () => {
    const blog = await makeBlog();
    const rec = await makeApprovedRecommendation({ target_ref: { blog_id: blog.id } });
    const created = await createAction(rec.id, {
      actionType: 'blog.update_seo_fields',
      parameters: { blog_id: blog.id, meta_title: 'New title' },
    });

    await executeAction(created.id, { userId: 1 });

    expect(await RecommendationOutcome.count({ where: { action_id: created.id } })).toBe(1);
  });

  test('2. successful manual completion creates exactly one outcome where applicable', async () => {
    const blog = await makeBlog();
    const rec = await makeApprovedRecommendation({ target_ref: { blog_id: blog.id } });
    const created = await createAction(rec.id, { actionType: 'update_blog_content' });

    await completeAction(created.id, { userId: 1 });

    expect(await RecommendationOutcome.count({ where: { action_id: created.id } })).toBe(1);
  });

  test('2b. manual completion with no resolvable target creates no outcome — "where applicable" honored', async () => {
    const rec = await makeApprovedRecommendation(); // no target_ref at all
    const created = await createAction(rec.id, { actionType: 'update_blog_content' });

    await completeAction(created.id, { userId: 1 });

    expect(await RecommendationOutcome.count({ where: { action_id: created.id } })).toBe(0);
  });

  test('8. a failed action does not create a successful baseline', async () => {
    const blog = await makeBlog();
    const rec = await makeApprovedRecommendation({ target_ref: { blog_id: blog.id } });

    // failAction path (manual)
    const manualAction = await createAction(rec.id, { actionType: 'update_blog_content' });
    await failAction(manualAction.id, { error: 'could not verify', userId: 1 });
    expect(await RecommendationOutcome.count({ where: { action_id: manualAction.id } })).toBe(0);

    // executeAction path failing on a bad block_id (automated)
    const rec2 = await makeApprovedRecommendation({ target_ref: { blog_id: blog.id } });
    const autoAction = await createAction(rec2.id, {
      actionType: 'blog.update_block',
      parameters: { blog_id: blog.id, block_id: 'does-not-exist', new_data: { text: 'x' } },
    });
    await expect(executeAction(autoAction.id, { userId: 1 })).rejects.toMatchObject({ code: 'BLOCK_NOT_FOUND' });
    expect(await RecommendationOutcome.count({ where: { action_id: autoAction.id } })).toBe(0);
  });

  test('9. duplicate completion does not create duplicate outcomes', async () => {
    const blog = await makeBlog();
    const rec = await makeApprovedRecommendation({ target_ref: { blog_id: blog.id } });
    const created = await createAction(rec.id, { actionType: 'update_blog_content' });

    await completeAction(created.id, { userId: 1 });
    await completeAction(created.id, { userId: 2 }); // idempotent no-op per the existing state machine

    expect(await RecommendationOutcome.count({ where: { action_id: created.id } })).toBe(1);
  });

  test('10. concurrent executeAction calls cannot create duplicate outcomes', async () => {
    const blog = await makeBlog();
    const rec = await makeApprovedRecommendation({ target_ref: { blog_id: blog.id } });
    const created = await createAction(rec.id, {
      actionType: 'blog.update_seo_fields',
      parameters: { blog_id: blog.id, meta_title: 'Race winner' },
    });

    const results = await Promise.allSettled([
      executeAction(created.id, { userId: 1 }),
      executeAction(created.id, { userId: 2 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

    expect(await RecommendationOutcome.count({ where: { action_id: created.id } })).toBe(1);
  });

  test('11. existing action state machine is unchanged by P2-B', async () => {
    const blog = await makeBlog();
    const rec = await makeApprovedRecommendation({ target_ref: { blog_id: blog.id } });
    const created = await createAction(rec.id, {
      actionType: 'blog.update_seo_fields',
      parameters: { blog_id: blog.id, meta_title: 'New title' },
    });

    const completed = await executeAction(created.id, { userId: 1 });

    expect(completed.status).toBe('completed');
    expect(completed.executor_type).toBe('automated');
    expect(completed.executed_by).toBe(1);
    expect(completed.result_summary).toMatchObject({ mutated_fields: ['meta_title'] });
    // re-executing an already-completed action is still a 409, exactly as P1-B4 guarantees
    await expect(executeAction(created.id, { userId: 1 })).rejects.toMatchObject({ code: 'ACTION_NOT_PENDING' });
  });

  test('12. recommendation state is unchanged by P2-B', async () => {
    const blog = await makeBlog();
    const rec = await makeApprovedRecommendation({ target_ref: { blog_id: blog.id } });
    const created = await createAction(rec.id, { actionType: 'update_blog_content' });

    await completeAction(created.id, { userId: 1 });

    const reloadedRec = await AgentRecommendation.findByPk(rec.id);
    expect(reloadedRec.status).toBe('approved'); // nothing in P2-B writes back to agent_recommendations
  });
});
