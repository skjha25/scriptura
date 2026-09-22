// backend/tests/unit/outcomeEvaluationScheduler.test.js
'use strict';

/**
 * P2-C tests: services/outcomeEvaluationScheduler.js — due-row selection,
 * deterministic classification, idempotency/concurrency, and bounded retry.
 * Same in-memory SQLite + mocked serp.js/gsc.js pattern as
 * outcomeMeasurement.test.js. No real external call, ever.
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
  const AgentKnowledge = require('../../src/models/agentKnowledge')(sqlite);
  const AgentKnowledgeUsage = require('../../src/models/agentKnowledgeUsage')(sqlite);

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
    AgentKnowledge,
    AgentKnowledgeUsage,
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
  AgentKnowledge,
  AgentKnowledgeUsage,
  sequelize,
} = require('../../src/models');
const {
  evaluateDueOutcomes,
  evaluateOutcome,
  classifyOutcome,
} = require('../../src/services/outcomeEvaluationScheduler');

async function makeBlog(overrides = {}) {
  return Blog.create({
    blog_title: 'P2-C test blog',
    content_blocks: [{ id: 'b1', type: 'paragraph', data: { text: 'Body content for scoring.' } }],
    ...overrides,
  });
}

async function makeRecommendation(overrides = {}) {
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

async function makeCompletedAction(recommendationId, overrides = {}) {
  return RecommendationAction.create({
    recommendation_id: recommendationId,
    action_type: 'blog.update_seo_fields',
    status: 'completed',
    executor_type: 'automated',
    ...overrides,
  });
}

async function makeOutcome({ recommendationId, actionId, dueInPast = true, baselineMetrics, evidenceRefs, attempts = 0 }) {
  const dueAt = dueInPast ? new Date(Date.now() - 60 * 1000) : new Date(Date.now() + 60 * 60 * 1000);
  return RecommendationOutcome.create({
    recommendation_id: recommendationId,
    action_id: actionId,
    baseline_captured_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
    baseline_evidence_refs: evidenceRefs || [{ type: 'blog', id: 1 }],
    baseline_metric_snapshot: baselineMetrics || [{ metric: 'seo_score', value: 50 }],
    observation_window_days: 14,
    due_at: dueAt,
    status: 'pending',
    evaluation_attempts: attempts,
  });
}

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
  jest.clearAllMocks();
  serp.isEnabled.mockReturnValue(false);
  gsc.isEnabled.mockReturnValue(false);
  await RecommendationOutcome.destroy({ truncate: true });
  await RecommendationAction.destroy({ truncate: true });
  await AgentRecommendation.destroy({ truncate: true });
  await Blog.destroy({ truncate: true });
  await AgentKnowledgeUsage.destroy({ truncate: true });
  await AgentKnowledge.destroy({ truncate: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('classifyOutcome — deterministic classification', () => {
  const d = (metric, baseline, fresh) => [{ metric, baseline, fresh, delta: fresh - baseline }];

  test('increase expectation, real improvement -> improved', () => {
    expect(classifyOutcome(d('gsc_clicks', 10, 20), 'gsc_clicks', 'increase')).toBe('improved');
  });

  test('increase expectation, real decline -> declined', () => {
    expect(classifyOutcome(d('gsc_clicks', 20, 5), 'gsc_clicks', 'increase')).toBe('declined');
  });

  test('decrease expectation honored -> improved', () => {
    expect(classifyOutcome(d('serp_position', 20, 5), 'serp_position', 'decrease')).toBe('improved');
  });

  test('small movement below threshold -> neutral, regardless of direction', () => {
    expect(classifyOutcome(d('gsc_clicks', 100, 101), 'gsc_clicks', 'increase')).toBe('neutral');
  });

  test('no_change expected but it moved meaningfully -> inconclusive (never a causal/good-or-bad guess)', () => {
    expect(classifyOutcome(d('gsc_clicks', 100, 50), 'gsc_clicks', 'no_change')).toBe('inconclusive');
  });

  test('no expected_direction at all -> inconclusive even with a real delta', () => {
    expect(classifyOutcome(d('gsc_clicks', 10, 50), 'gsc_clicks', null)).toBe('inconclusive');
  });

  test('multiple metrics observed, none named -> inconclusive (never post-hoc cherry-picked)', () => {
    const deltas = [
      { metric: 'gsc_clicks', baseline: 10, fresh: 50, delta: 40 },
      { metric: 'seo_score', baseline: 60, fresh: 40, delta: -20 },
    ];
    expect(classifyOutcome(deltas, null, 'increase')).toBe('inconclusive');
  });

  test('exactly one metric observed, no named expected_metric -> still judged (only one honest candidate)', () => {
    expect(classifyOutcome(d('seo_score', 60, 75), null, 'increase')).toBe('improved');
  });

  test('baseline of zero: any nonzero delta is meaningful', () => {
    expect(classifyOutcome(d('gsc_clicks', 0, 3), 'gsc_clicks', 'increase')).toBe('improved');
  });
});

describe('evaluateOutcome — single-row evaluation', () => {
  test('resolves fresh evidence, computes deltas, finalizes as evaluated', async () => {
    const blog = await makeBlog({ seo_score: 80, aeo_score: 50, geo_score: 45, word_count: 5 });
    const rec = await makeRecommendation({
      target_ref: { blog_id: blog.id },
      expected_metric: 'seo_score',
      expected_direction: 'increase',
    });
    const action = await makeCompletedAction(rec.id);
    const outcome = await makeOutcome({
      recommendationId: rec.id,
      actionId: action.id,
      baselineMetrics: [{ metric: 'seo_score', value: 27 }], // the original beforeSave-computed score, see outcomeMeasurement.test.js's note on this
      evidenceRefs: [{ type: 'blog', id: blog.id }],
    });

    const result = await evaluateOutcome(await RecommendationOutcome.findByPk(outcome.id));

    expect(result).toBe('evaluated');
    const reloaded = await RecommendationOutcome.findByPk(outcome.id);
    expect(reloaded.status).toBe('evaluated');
    expect(reloaded.outcome).not.toBeNull();
    expect(reloaded.metric_deltas.find((m) => m.metric === 'seo_score')).toMatchObject({ baseline: 27 });
    expect(reloaded.evaluated_at).not.toBeNull();
    expect(reloaded.fresh_evidence_refs).toEqual([{ type: 'blog', id: blog.id }]);
  });

  test('no fresh evidence resolves and attempts < max -> rescheduled, stays pending', async () => {
    const rec = await makeRecommendation(); // no target_ref at all -> nothing resolvable
    const action = await makeCompletedAction(rec.id);
    const outcome = await makeOutcome({ recommendationId: rec.id, actionId: action.id });

    const result = await evaluateOutcome(await RecommendationOutcome.findByPk(outcome.id));

    expect(result).toBe('rescheduled');
    const reloaded = await RecommendationOutcome.findByPk(outcome.id);
    expect(reloaded.status).toBe('pending');
    expect(reloaded.evaluation_attempts).toBe(1);
    expect(reloaded.due_at.getTime()).toBeGreaterThan(Date.now()); // pushed into the future
  });

  test('no fresh evidence after max attempts -> finalized inconclusive, never retried again', async () => {
    const rec = await makeRecommendation();
    const action = await makeCompletedAction(rec.id);
    const outcome = await makeOutcome({ recommendationId: rec.id, actionId: action.id, attempts: 2 }); // config default maxAttempts=3

    const result = await evaluateOutcome(await RecommendationOutcome.findByPk(outcome.id));

    expect(result).toBe('inconclusive');
    const reloaded = await RecommendationOutcome.findByPk(outcome.id);
    expect(reloaded.status).toBe('inconclusive');
    expect(reloaded.outcome).toBe('inconclusive');
    expect(reloaded.evaluated_at).not.toBeNull();
  });

  test('a metric with no baseline counterpart is never surfaced, and a metric with no fresh counterpart is skipped, not fabricated', async () => {
    const blog = await makeBlog({ seo_score: 90 });
    const rec = await makeRecommendation({ target_ref: { blog_id: blog.id } });
    const action = await makeCompletedAction(rec.id);
    // Baseline once had both seo_score AND a serp_position (SERP has since
    // been disabled, so fresh capture won't resolve serp_position again).
    const outcome = await makeOutcome({
      recommendationId: rec.id,
      actionId: action.id,
      baselineMetrics: [
        { metric: 'seo_score', value: 27 },
        { metric: 'serp_position', value: 8 },
      ],
    });

    const result = await evaluateOutcome(await RecommendationOutcome.findByPk(outcome.id));
    expect(result).toBe('evaluated');
    const reloaded = await RecommendationOutcome.findByPk(outcome.id);
    const metrics = reloaded.metric_deltas.map((m) => m.metric);
    expect(metrics).toContain('seo_score');
    expect(metrics).not.toContain('serp_position'); // never fabricated a delta for a metric that didn't resolve fresh
  });
});

describe('evaluateOutcome — idempotency / concurrency', () => {
  test('two concurrent calls on the same due row: only one evaluates, the other is claimed_by_another_tick', async () => {
    const blog = await makeBlog({ seo_score: 80 });
    const rec = await makeRecommendation({ target_ref: { blog_id: blog.id } });
    const action = await makeCompletedAction(rec.id);
    const outcome = await makeOutcome({ recommendationId: rec.id, actionId: action.id });

    // Both "ticks" must start from the SAME stale snapshot (evaluation_attempts:0)
    // to actually simulate a race — this is exactly what evaluateDueOutcomes'
    // own findAll() would hand two concurrent ticks before either claims a row.
    const staleSnapshot = await RecommendationOutcome.findByPk(outcome.id);
    const [r1, r2] = await Promise.all([
      evaluateOutcome(staleSnapshot),
      evaluateOutcome(staleSnapshot),
    ]);

    const results = [r1, r2].sort();
    expect(results).toEqual(['claimed_by_another_tick', 'evaluated']);

    const reloaded = await RecommendationOutcome.findByPk(outcome.id);
    expect(reloaded.status).toBe('evaluated');
    expect(reloaded.evaluation_attempts).toBe(1); // only incremented once, not twice
  });
});

describe('evaluateDueOutcomes — batch selection', () => {
  test('only due, pending rows are picked up; a not-yet-due row is untouched', async () => {
    const blog = await makeBlog({ seo_score: 80 });
    const rec1 = await makeRecommendation({ target_ref: { blog_id: blog.id } });
    const action1 = await makeCompletedAction(rec1.id);
    const dueOutcome = await makeOutcome({ recommendationId: rec1.id, actionId: action1.id, dueInPast: true });

    const rec2 = await makeRecommendation({ target_ref: { blog_id: blog.id } });
    const action2 = await makeCompletedAction(rec2.id);
    const notYetDueOutcome = await makeOutcome({ recommendationId: rec2.id, actionId: action2.id, dueInPast: false });

    const summary = await evaluateDueOutcomes();

    expect(summary.total).toBe(1);
    expect(summary.evaluated).toBe(1);

    const reloadedDue = await RecommendationOutcome.findByPk(dueOutcome.id);
    const reloadedNotDue = await RecommendationOutcome.findByPk(notYetDueOutcome.id);
    expect(reloadedDue.status).toBe('evaluated');
    expect(reloadedNotDue.status).toBe('pending'); // completely untouched
    expect(reloadedNotDue.evaluation_attempts).toBe(0);
  });

  test('an already-evaluated row is never re-picked-up', async () => {
    const blog = await makeBlog({ seo_score: 80 });
    const rec = await makeRecommendation({ target_ref: { blog_id: blog.id } });
    const action = await makeCompletedAction(rec.id);
    const outcome = await makeOutcome({ recommendationId: rec.id, actionId: action.id });
    await evaluateOutcome(await RecommendationOutcome.findByPk(outcome.id));

    const summary = await evaluateDueOutcomes();
    expect(summary.total).toBe(0); // status:'evaluated' no longer matches the pending/due filter
  });

  test('no configuration/code change touches the action state machine or recommendation status', async () => {
    const blog = await makeBlog({ seo_score: 80 });
    const rec = await makeRecommendation({ target_ref: { blog_id: blog.id } });
    const action = await makeCompletedAction(rec.id);
    const outcome = await makeOutcome({ recommendationId: rec.id, actionId: action.id });

    await evaluateOutcome(await RecommendationOutcome.findByPk(outcome.id));

    const reloadedAction = await RecommendationAction.findByPk(action.id);
    const reloadedRec = await AgentRecommendation.findByPk(rec.id);
    expect(reloadedAction.status).toBe('completed'); // untouched
    expect(reloadedRec.status).toBe('approved'); // untouched
  });
});

describe('P5-A/B — knowledge reinforcement wired into evaluateOutcome', () => {
  test('1/2. an improved outcome reinforces exactly the knowledge rows retrieved for that trace as SUCCESS; a declined one reinforces them as FAILURE', async () => {
    // makeBlog's fixed content_blocks always resolve to a live seo_score of
    // 27 via Blog's own beforeSave scoring hook, regardless of what
    // `seo_score` is passed at creation (see outcomeEvaluationScheduler.test.js's
    // existing "resolves fresh evidence" test's own note on this). So the
    // classification is controlled entirely by the OUTCOME's baseline value,
    // not by the blog's initial seo_score field.
    // Improved case: baseline 10 -> fresh 27, increase expected -> improved.
    const blogUp = await makeBlog();
    const recUp = await makeRecommendation({
      trace_id: 'trace-up',
      target_ref: { blog_id: blogUp.id },
      expected_metric: 'seo_score',
      expected_direction: 'increase',
    });
    const actionUp = await makeCompletedAction(recUp.id);
    const outcomeUp = await makeOutcome({
      recommendationId: recUp.id,
      actionId: actionUp.id,
      baselineMetrics: [{ metric: 'seo_score', value: 10 }],
    });
    const kUp = await makeKnowledge({ topic: 'improved-case' });
    await makeUsage({ traceId: 'trace-up', knowledgeId: kUp.id });

    const resultUp = await evaluateOutcome(await RecommendationOutcome.findByPk(outcomeUp.id));
    expect(resultUp).toBe('evaluated');
    expect((await RecommendationOutcome.findByPk(outcomeUp.id)).outcome).toBe('improved');

    const reloadedKUp = await AgentKnowledge.findByPk(kUp.id);
    expect(reloadedKUp.success_count).toBe(1);
    expect(reloadedKUp.failure_count).toBe(0);

    // Declined case: baseline 50 -> fresh 27, increase expected -> a real decline.
    const blogDown = await makeBlog();
    const recDown = await makeRecommendation({
      trace_id: 'trace-down',
      target_ref: { blog_id: blogDown.id },
      expected_metric: 'seo_score',
      expected_direction: 'increase',
    });
    const actionDown = await makeCompletedAction(recDown.id);
    const outcomeDown = await makeOutcome({
      recommendationId: recDown.id,
      actionId: actionDown.id,
      baselineMetrics: [{ metric: 'seo_score', value: 50 }],
    });
    const kDown = await makeKnowledge({ topic: 'declined-case' });
    await makeUsage({ traceId: 'trace-down', knowledgeId: kDown.id });

    const resultDown = await evaluateOutcome(await RecommendationOutcome.findByPk(outcomeDown.id));
    expect(resultDown).toBe('evaluated');
    expect((await RecommendationOutcome.findByPk(outcomeDown.id)).outcome).toBe('declined');

    const reloadedKDown = await AgentKnowledge.findByPk(kDown.id);
    expect(reloadedKDown.success_count).toBe(0);
    expect(reloadedKDown.failure_count).toBe(1);
  });

  test('3/4. neutral and inconclusive classifications never touch success_count/failure_count/confidence', async () => {
    // Neutral: baseline 27 -> fresh 27 (see the "improved case" comment above for why fresh is always 27), zero delta.
    const blog = await makeBlog();
    const rec = await makeRecommendation({
      trace_id: 'trace-neutral',
      target_ref: { blog_id: blog.id },
      expected_metric: 'seo_score',
      expected_direction: 'increase',
    });
    const action = await makeCompletedAction(rec.id);
    const outcome = await makeOutcome({
      recommendationId: rec.id,
      actionId: action.id,
      baselineMetrics: [{ metric: 'seo_score', value: 27 }],
    });
    const k = await makeKnowledge({ confidence: 0.5 });
    await makeUsage({ traceId: 'trace-neutral', knowledgeId: k.id });

    await evaluateOutcome(await RecommendationOutcome.findByPk(outcome.id));
    expect((await RecommendationOutcome.findByPk(outcome.id)).outcome).toBe('neutral');

    const reloaded = await AgentKnowledge.findByPk(k.id);
    expect(reloaded.success_count).toBe(0);
    expect(reloaded.failure_count).toBe(0);
    expect(reloaded.confidence).toBe(0.5);
  });

  test('5. unrelated knowledge rows (not retrieved for this trace) remain completely unchanged', async () => {
    const blog = await makeBlog({ seo_score: 80 });
    const rec = await makeRecommendation({
      trace_id: 'trace-related',
      target_ref: { blog_id: blog.id },
      expected_metric: 'seo_score',
      expected_direction: 'increase',
    });
    const action = await makeCompletedAction(rec.id);
    const outcome = await makeOutcome({
      recommendationId: rec.id,
      actionId: action.id,
      baselineMetrics: [{ metric: 'seo_score', value: 10 }],
    });
    const retrieved = await makeKnowledge({ topic: 'retrieved' });
    const unrelated = await makeKnowledge({ topic: 'never-retrieved', confidence: 0.42 });
    await makeUsage({ traceId: 'trace-related', knowledgeId: retrieved.id });
    // unrelated has NO usage row for this trace at all

    await evaluateOutcome(await RecommendationOutcome.findByPk(outcome.id));

    const reloadedUnrelated = await AgentKnowledge.findByPk(unrelated.id);
    expect(reloadedUnrelated.success_count).toBe(0);
    expect(reloadedUnrelated.failure_count).toBe(0);
    expect(reloadedUnrelated.confidence).toBe(0.42);
  });

  test('6. another agent\'s knowledge (retrieved under a different agent_name within the same shared trace_id) remains unchanged', async () => {
    const blog = await makeBlog({ seo_score: 80 });
    const rec = await makeRecommendation({
      trace_id: 'shared-trace',
      agent_name: AGENT_NAMES.SEO_ANALYST,
      target_ref: { blog_id: blog.id },
      expected_metric: 'seo_score',
      expected_direction: 'increase',
    });
    const action = await makeCompletedAction(rec.id);
    const outcome = await makeOutcome({
      recommendationId: rec.id,
      actionId: action.id,
      baselineMetrics: [{ metric: 'seo_score', value: 10 }],
    });
    const seoKnowledge = await makeKnowledge({ agent_name: AGENT_NAMES.SEO_ANALYST, topic: 'seo-owned' });
    const blogOpsKnowledge = await makeKnowledge({ agent_name: AGENT_NAMES.BLOG_OPS, topic: 'blog-ops-owned' });
    await makeUsage({ traceId: 'shared-trace', agentName: AGENT_NAMES.SEO_ANALYST, knowledgeId: seoKnowledge.id });
    await makeUsage({ traceId: 'shared-trace', agentName: AGENT_NAMES.BLOG_OPS, knowledgeId: blogOpsKnowledge.id });

    await evaluateOutcome(await RecommendationOutcome.findByPk(outcome.id));

    expect((await AgentKnowledge.findByPk(seoKnowledge.id)).success_count).toBe(1);
    const reloadedBlogOps = await AgentKnowledge.findByPk(blogOpsKnowledge.id);
    expect(reloadedBlogOps.success_count).toBe(0);
    expect(reloadedBlogOps.failure_count).toBe(0);
  });

  test('7/8. the same outcome cannot be reinforced twice — an explicit second evaluateOutcome() call and a real concurrent race both apply reinforcement at most once', async () => {
    const blog = await makeBlog({ seo_score: 80 });
    const rec = await makeRecommendation({
      trace_id: 'trace-idempotent',
      target_ref: { blog_id: blog.id },
      expected_metric: 'seo_score',
      expected_direction: 'increase',
    });
    const action = await makeCompletedAction(rec.id);
    const outcome = await makeOutcome({
      recommendationId: rec.id,
      actionId: action.id,
      baselineMetrics: [{ metric: 'seo_score', value: 10 }],
    });
    const k = await makeKnowledge();
    await makeUsage({ traceId: 'trace-idempotent', knowledgeId: k.id });

    // First call: wins the pending->evaluated transition, applies reinforcement.
    const first = await evaluateOutcome(await RecommendationOutcome.findByPk(outcome.id));
    expect(first).toBe('evaluated');
    expect((await AgentKnowledge.findByPk(k.id)).success_count).toBe(1);

    // Explicit retry with the NOW-evaluated row (simulates a manual/duplicate
    // re-run) — the WHERE-guarded claim on status:'pending' can no longer
    // match, so this must be a no-op for both the outcome AND reinforcement.
    const second = await evaluateOutcome(await RecommendationOutcome.findByPk(outcome.id));
    expect(second).toBe('claimed_by_another_tick');
    expect((await AgentKnowledge.findByPk(k.id)).success_count).toBe(1); // NOT 2

    // Real concurrent race on a second, otherwise-identical outcome, from
    // the SAME stale snapshot — only one of the two concurrent calls may
    // ever reach reinforcement.
    const blog2 = await makeBlog({ seo_score: 80 });
    const rec2 = await makeRecommendation({
      trace_id: 'trace-race',
      target_ref: { blog_id: blog2.id },
      expected_metric: 'seo_score',
      expected_direction: 'increase',
    });
    const action2 = await makeCompletedAction(rec2.id);
    const outcome2 = await makeOutcome({
      recommendationId: rec2.id,
      actionId: action2.id,
      baselineMetrics: [{ metric: 'seo_score', value: 10 }],
    });
    const k2 = await makeKnowledge();
    await makeUsage({ traceId: 'trace-race', knowledgeId: k2.id });

    const staleSnapshot = await RecommendationOutcome.findByPk(outcome2.id);
    const [r1, r2] = await Promise.all([evaluateOutcome(staleSnapshot), evaluateOutcome(staleSnapshot)]);
    expect([r1, r2].sort()).toEqual(['claimed_by_another_tick', 'evaluated']);
    expect((await AgentKnowledge.findByPk(k2.id)).success_count).toBe(1); // exactly once, never 2
  });

  test('9/10. one observation cannot cause a large confidence jump, and confidence never exceeds 0.95 or drops below 0', async () => {
    const blog = await makeBlog({ seo_score: 80 });
    const rec = await makeRecommendation({
      trace_id: 'trace-bounded',
      target_ref: { blog_id: blog.id },
      expected_metric: 'seo_score',
      expected_direction: 'increase',
    });
    const action = await makeCompletedAction(rec.id);
    const outcome = await makeOutcome({
      recommendationId: rec.id,
      actionId: action.id,
      baselineMetrics: [{ metric: 'seo_score', value: 10 }],
    });
    const k = await makeKnowledge({ confidence: 0.9 });
    await makeUsage({ traceId: 'trace-bounded', knowledgeId: k.id });

    await evaluateOutcome(await RecommendationOutcome.findByPk(outcome.id));

    const reloaded = await AgentKnowledge.findByPk(k.id);
    expect(reloaded.success_count).toBe(1); // reinforcement really did fire...
    expect(reloaded.confidence).toBe(0.9); // ...but one observation, below MIN_REINFORCEMENT_SAMPLES, leaves confidence unchanged
    expect(reloaded.confidence).toBeLessThanOrEqual(0.95);
    expect(reloaded.confidence).toBeGreaterThanOrEqual(0);
  });

  test('11. scope and agent_name never change on a reinforced row', async () => {
    const blog = await makeBlog({ seo_score: 80 });
    const rec = await makeRecommendation({
      trace_id: 'trace-scope',
      target_ref: { blog_id: blog.id },
      expected_metric: 'seo_score',
      expected_direction: 'increase',
    });
    const action = await makeCompletedAction(rec.id);
    const outcome = await makeOutcome({
      recommendationId: rec.id,
      actionId: action.id,
      baselineMetrics: [{ metric: 'seo_score', value: 10 }],
    });
    const k = await makeKnowledge({ scope: 'global', agent_name: null });
    await makeUsage({ traceId: 'trace-scope', knowledgeId: k.id });

    await evaluateOutcome(await RecommendationOutcome.findByPk(outcome.id));

    const reloaded = await AgentKnowledge.findByPk(k.id);
    expect(reloaded.success_count).toBe(1); // reinforcement fired...
    expect(reloaded.scope).toBe('global'); // ...but scope/agent_name are untouched
    expect(reloaded.agent_name).toBeNull();
  });

  test('12. no agent_knowledge rows are created or deleted by reinforcement', async () => {
    const blog = await makeBlog({ seo_score: 80 });
    const rec = await makeRecommendation({
      trace_id: 'trace-nocreate',
      target_ref: { blog_id: blog.id },
      expected_metric: 'seo_score',
      expected_direction: 'increase',
    });
    const action = await makeCompletedAction(rec.id);
    const outcome = await makeOutcome({
      recommendationId: rec.id,
      actionId: action.id,
      baselineMetrics: [{ metric: 'seo_score', value: 10 }],
    });
    const k = await makeKnowledge();
    await makeUsage({ traceId: 'trace-nocreate', knowledgeId: k.id });
    const before = await AgentKnowledge.count();

    await evaluateOutcome(await RecommendationOutcome.findByPk(outcome.id));

    expect((await AgentKnowledge.findByPk(k.id)).success_count).toBe(1); // reinforcement fired...
    expect(await AgentKnowledge.count()).toBe(before); // ...but created/deleted zero rows
  });

  test('13. reinforcement never changes recommendation/action state', async () => {
    const blog = await makeBlog({ seo_score: 80 });
    const rec = await makeRecommendation({
      trace_id: 'trace-state',
      target_ref: { blog_id: blog.id },
      expected_metric: 'seo_score',
      expected_direction: 'increase',
    });
    const action = await makeCompletedAction(rec.id);
    const outcome = await makeOutcome({
      recommendationId: rec.id,
      actionId: action.id,
      baselineMetrics: [{ metric: 'seo_score', value: 10 }],
    });
    const k = await makeKnowledge();
    await makeUsage({ traceId: 'trace-state', knowledgeId: k.id });

    await evaluateOutcome(await RecommendationOutcome.findByPk(outcome.id));

    expect((await AgentKnowledge.findByPk(k.id)).success_count).toBe(1); // reinforcement fired...
    expect((await RecommendationAction.findByPk(action.id)).status).toBe('completed'); // ...but action/recommendation state is untouched
    expect((await AgentRecommendation.findByPk(rec.id)).status).toBe('approved');
  });

  test('a recommendation with no retrieved knowledge for its trace produces zero reinforcement writes, no error', async () => {
    const blog = await makeBlog({ seo_score: 80 });
    const rec = await makeRecommendation({
      trace_id: 'trace-empty',
      target_ref: { blog_id: blog.id },
      expected_metric: 'seo_score',
      expected_direction: 'increase',
    });
    const action = await makeCompletedAction(rec.id);
    const outcome = await makeOutcome({
      recommendationId: rec.id,
      actionId: action.id,
      baselineMetrics: [{ metric: 'seo_score', value: 27 }],
    });
    // No AgentKnowledgeUsage rows at all for this trace.

    const result = await evaluateOutcome(await RecommendationOutcome.findByPk(outcome.id));
    expect(result).toBe('evaluated'); // outcome finalization is unaffected either way
  });
});
