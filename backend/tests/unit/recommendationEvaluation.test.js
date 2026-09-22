// backend/tests/unit/recommendationEvaluation.test.js
'use strict';

/**
 * P3-A tests: services/agents/recommendationEvaluation.js — pure read-only
 * aggregation, no new storage. Same in-memory SQLite pattern as every prior
 * P2 test file. No real DB or network touched.
 */

jest.mock('../../src/models', () => {
  const { Sequelize } = require('sequelize');
  const sqlite = new Sequelize('sqlite::memory:', { logging: false });
  const User = require('../../src/models/user')(sqlite);
  const AgentActivity = require('../../src/models/agentActivity')(sqlite);
  const AgentRecommendation = require('../../src/models/agentRecommendation')(sqlite);
  const RecommendationAction = require('../../src/models/recommendationAction')(sqlite);
  const RecommendationOutcome = require('../../src/models/recommendationOutcome')(sqlite);

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
    sequelize: sqlite,
    Sequelize,
  };
});

const { AGENT_NAMES } = require('../../src/constants');
const { AgentRecommendation, RecommendationAction, RecommendationOutcome, sequelize } = require('../../src/models');
const { getActionTypeEffectiveness, MIN_SAMPLE_SIZE_FOR_RATE } = require('../../src/services/agents/recommendationEvaluation');

let nextAttemptSuffix = 0;

/** Seeds one full recommendation -> action -> outcome chain with a given classification. */
async function seedOutcome({ actionType = 'blog.update_seo_fields', recommendationType = 'recommend_seo_action', agentName = AGENT_NAMES.SEO_ANALYST, outcome, status = 'evaluated', evaluatedAt = new Date() }) {
  nextAttemptSuffix += 1;
  const rec = await AgentRecommendation.create({
    trace_id: `trace-${nextAttemptSuffix}`,
    agent_name: agentName,
    recommendation_type: recommendationType,
    recommendation_details: { recommendation: 'x', rationale: 'x' },
    status: 'approved',
    decided_by: 1,
    decided_at: new Date(),
  });
  const action = await RecommendationAction.create({
    recommendation_id: rec.id,
    action_type: actionType,
    status: 'completed',
    executor_type: 'automated',
  });
  return RecommendationOutcome.create({
    recommendation_id: rec.id,
    action_id: action.id,
    baseline_captured_at: new Date(),
    baseline_evidence_refs: [{ type: 'blog', id: 1 }],
    baseline_metric_snapshot: [{ metric: 'seo_score', value: 50 }],
    observation_window_days: 14,
    due_at: new Date(),
    status,
    outcome,
    evaluated_at: status === 'pending' ? null : evaluatedAt,
  });
}

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  await RecommendationOutcome.destroy({ truncate: true });
  await RecommendationAction.destroy({ truncate: true });
  await AgentRecommendation.destroy({ truncate: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('getActionTypeEffectiveness — rate calculation', () => {
  test('at/above MIN_SAMPLE_SIZE_FOR_RATE, computes a real rate with no confidence flag', async () => {
    expect(MIN_SAMPLE_SIZE_FOR_RATE).toBe(5); // documents the exact constant this test relies on
    for (let i = 0; i < 3; i += 1) await seedOutcome({ outcome: 'improved' });
    await seedOutcome({ outcome: 'declined' });
    await seedOutcome({ outcome: 'neutral' });

    const [result] = await getActionTypeEffectiveness({ actionType: 'blog.update_seo_fields' });

    expect(result).toMatchObject({
      dimension_value: 'blog.update_seo_fields',
      sample_size: 5,
      improved: 3,
      declined: 1,
      neutral: 1,
      inconclusive: 0,
      confidence_note: null,
    });
    expect(result.improved_rate).toBeCloseTo(3 / 5);
  });

  test('below MIN_SAMPLE_SIZE_FOR_RATE, improved_rate is null with confidence_note — counts are still real', async () => {
    for (let i = 0; i < 3; i += 1) await seedOutcome({ outcome: 'improved' });
    await seedOutcome({ outcome: 'declined' });

    const [result] = await getActionTypeEffectiveness({ actionType: 'blog.update_seo_fields' });

    expect(result.sample_size).toBe(4);
    expect(result.improved).toBe(3);
    expect(result.improved_rate).toBeNull();
    expect(result.confidence_note).toBe('insufficient_sample');
  });

  test('zero outcomes for a dimension value returns an empty array — never a fabricated zero row', async () => {
    const result = await getActionTypeEffectiveness({ actionType: 'blog.update_seo_fields' });
    expect(result).toEqual([]);
  });

  test('pending (not-yet-evaluated) outcomes are excluded from every count', async () => {
    await seedOutcome({ outcome: 'improved' });
    await seedOutcome({ outcome: null, status: 'pending' });

    const [result] = await getActionTypeEffectiveness({ actionType: 'blog.update_seo_fields' });
    expect(result.sample_size).toBe(1);
  });

  test('status:"inconclusive" rows (gave up after max attempts) are counted under the inconclusive bucket', async () => {
    await seedOutcome({ outcome: 'inconclusive', status: 'inconclusive' });
    await seedOutcome({ outcome: 'improved' });

    const [result] = await getActionTypeEffectiveness({ actionType: 'blog.update_seo_fields' });
    expect(result.sample_size).toBe(2);
    expect(result.inconclusive).toBe(1);
  });
});

describe('getActionTypeEffectiveness — grouping and filters', () => {
  test('groups by action_type by default, one row per distinct value', async () => {
    await seedOutcome({ actionType: 'blog.update_seo_fields', outcome: 'improved' });
    await seedOutcome({ actionType: 'blog.update_seo_fields', outcome: 'declined' });
    await seedOutcome({ actionType: 'blog.update_block', outcome: 'improved' });

    const result = await getActionTypeEffectiveness();
    const byDimension = Object.fromEntries(result.map((r) => [r.dimension_value, r]));
    expect(byDimension['blog.update_seo_fields'].sample_size).toBe(2);
    expect(byDimension['blog.update_block'].sample_size).toBe(1);
  });

  test('groupBy:"recommendation_type" groups by the parent recommendation instead', async () => {
    await seedOutcome({ recommendationType: 'recommend_seo_action', outcome: 'improved' });
    await seedOutcome({ recommendationType: 'recommend_content_action', outcome: 'declined' });

    const result = await getActionTypeEffectiveness({ groupBy: 'recommendation_type' });
    const byDimension = Object.fromEntries(result.map((r) => [r.dimension_value, r]));
    expect(byDimension.recommend_seo_action.improved).toBe(1);
    expect(byDimension.recommend_content_action.declined).toBe(1);
  });

  test('agentName filter narrows correctly', async () => {
    await seedOutcome({ agentName: AGENT_NAMES.SEO_ANALYST, outcome: 'improved' });
    await seedOutcome({ agentName: AGENT_NAMES.BLOG_OPS, outcome: 'declined' });

    const result = await getActionTypeEffectiveness({ agentName: AGENT_NAMES.SEO_ANALYST });
    const total = result.reduce((sum, r) => sum + r.sample_size, 0);
    expect(total).toBe(1);
  });

  test('sinceDate filter excludes older evaluations', async () => {
    await seedOutcome({ outcome: 'improved', evaluatedAt: new Date('2020-01-01') });
    await seedOutcome({ outcome: 'declined', evaluatedAt: new Date('2027-01-01') });

    const result = await getActionTypeEffectiveness({ sinceDate: '2025-01-01' });
    const total = result.reduce((sum, r) => sum + r.sample_size, 0);
    expect(total).toBe(1);
  });

  test('an invalid groupBy value throws rather than silently misbehaving', async () => {
    await expect(getActionTypeEffectiveness({ groupBy: 'not_a_real_dimension' })).rejects.toThrow();
  });

  test('results are sorted by sample_size descending', async () => {
    await seedOutcome({ actionType: 'blog.update_block', outcome: 'improved' });
    for (let i = 0; i < 3; i += 1) await seedOutcome({ actionType: 'blog.update_seo_fields', outcome: 'improved' });

    const result = await getActionTypeEffectiveness();
    expect(result[0].dimension_value).toBe('blog.update_seo_fields');
    expect(result[0].sample_size).toBeGreaterThan(result[1].sample_size);
  });
});
