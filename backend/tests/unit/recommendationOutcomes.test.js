// backend/tests/unit/recommendationOutcomes.test.js
'use strict';

/**
 * P2-A tests: the recommendation_outcomes table/model/associations only —
 * no service logic exists yet (that's P2-B, tested separately in
 * outcomeMeasurement.test.js). Isolated against an in-memory SQLite instance
 * built from the real model factories, same pattern as
 * recommendationActions.test.js. No real DB or network is touched.
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

async function makeApprovedRecommendation(overrides = {}) {
  return AgentRecommendation.create({
    trace_id: 'trace-parent',
    agent_name: AGENT_NAMES.SEO_ANALYST,
    recommendation_type: 'recommend_seo_action',
    recommendation_details: { recommendation: 'Update meta_title on Article #1.', rationale: 'x' },
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
    executed_by: 1,
    result_summary: { before: { meta_title: 'Old' }, after: { meta_title: 'New' }, mutated_fields: ['meta_title'] },
    completed_at: new Date(),
    ...overrides,
  });
}

/** Minimal, valid outcome-row fields every test below builds on — P2-B's outcomeMeasurement.js is what actually populates these for real; this file only exercises the table/model/associations themselves. */
function baseOutcomeFields(overrides = {}) {
  return {
    baseline_captured_at: new Date(),
    baseline_evidence_refs: [{ type: 'gsc_snapshot', id: 1 }],
    baseline_metric_snapshot: [{ metric: 'seo_score', value: 62 }],
    observation_window_days: 14,
    due_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
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

describe('RecommendationOutcome — create/read', () => {
  test('creates an outcome row with defaults applied', async () => {
    const rec = await makeApprovedRecommendation();
    const action = await makeCompletedAction(rec.id);

    const outcome = await RecommendationOutcome.create({
      recommendation_id: rec.id,
      action_id: action.id,
      ...baseOutcomeFields(),
    });

    expect(outcome.status).toBe('pending');
    expect(outcome.evaluation_attempts).toBe(0);

    const reloaded = await RecommendationOutcome.findByPk(outcome.id);
    expect(reloaded.fresh_evidence_refs).toBeNull();
    expect(reloaded.metric_deltas).toBeNull();
    expect(reloaded.outcome).toBeNull();
  });

  test('JSON columns round-trip correctly', async () => {
    const rec = await makeApprovedRecommendation();
    const action = await makeCompletedAction(rec.id);
    const refs = [{ type: 'gsc_snapshot', id: 42 }, { type: 'serp_snapshot', id: 7 }];
    const metrics = [{ metric: 'gsc_clicks', value: 20 }, { metric: 'serp_position', value: 5 }];

    const outcome = await RecommendationOutcome.create({
      recommendation_id: rec.id,
      action_id: action.id,
      ...baseOutcomeFields({ baseline_evidence_refs: refs, baseline_metric_snapshot: metrics }),
    });

    const reloaded = await RecommendationOutcome.findByPk(outcome.id);
    expect(reloaded.baseline_evidence_refs).toEqual(refs);
    expect(reloaded.baseline_metric_snapshot).toEqual(metrics);
  });

  test('outcome/metric_deltas/outcome_reasoning are independently settable, deterministic fields stay separate from the LLM-authored one', async () => {
    const rec = await makeApprovedRecommendation();
    const action = await makeCompletedAction(rec.id);
    const outcome = await RecommendationOutcome.create({
      recommendation_id: rec.id,
      action_id: action.id,
      ...baseOutcomeFields(),
    });

    await outcome.update({
      status: 'evaluated',
      fresh_evidence_refs: [{ type: 'gsc_snapshot', id: 2 }],
      metric_deltas: [{ metric: 'gsc_clicks', baseline: 10, fresh: 15, delta: 5 }],
      outcome: 'improved',
      outcome_reasoning: 'Clicks rose after the meta title change.',
      evaluated_at: new Date(),
    });

    const reloaded = await RecommendationOutcome.findByPk(outcome.id);
    expect(reloaded.outcome).toBe('improved');
    expect(reloaded.metric_deltas).toEqual([{ metric: 'gsc_clicks', baseline: 10, fresh: 15, delta: 5 }]);
    expect(reloaded.outcome_reasoning).toBe('Clicks rose after the meta title change.');
  });
});

describe('RecommendationOutcome — FK / uniqueness behavior', () => {
  test('action_id is unique — a second outcome for the same action is rejected', async () => {
    const rec = await makeApprovedRecommendation();
    const action = await makeCompletedAction(rec.id);

    await RecommendationOutcome.create({
      recommendation_id: rec.id,
      action_id: action.id,
      ...baseOutcomeFields(),
    });

    await expect(
      RecommendationOutcome.create({
        recommendation_id: rec.id,
        action_id: action.id,
        ...baseOutcomeFields(),
      })
    ).rejects.toThrow();
  });

  test('a retried attempt (a second action on the same recommendation) can earn its own outcome row', async () => {
    const rec = await makeApprovedRecommendation();
    const firstAction = await makeCompletedAction(rec.id, { attempt_number: 1 });
    const secondAction = await makeCompletedAction(rec.id, { attempt_number: 2 });

    await RecommendationOutcome.create({
      recommendation_id: rec.id,
      action_id: firstAction.id,
      ...baseOutcomeFields(),
    });
    await RecommendationOutcome.create({
      recommendation_id: rec.id,
      action_id: secondAction.id,
      ...baseOutcomeFields(),
    });

    expect(await RecommendationOutcome.count({ where: { recommendation_id: rec.id } })).toBe(2);
  });
});

describe('RecommendationOutcome — associations', () => {
  test('navigates recommendation -> outcomes and action -> outcome', async () => {
    const rec = await makeApprovedRecommendation();
    const action = await makeCompletedAction(rec.id);
    const outcome = await RecommendationOutcome.create({
      recommendation_id: rec.id,
      action_id: action.id,
      ...baseOutcomeFields(),
    });

    const recWithOutcomes = await AgentRecommendation.findByPk(rec.id, { include: [{ model: RecommendationOutcome, as: 'outcomes' }] });
    expect(recWithOutcomes.outcomes).toHaveLength(1);
    expect(recWithOutcomes.outcomes[0].id).toBe(outcome.id);

    const actionWithOutcome = await RecommendationAction.findByPk(action.id, { include: [{ model: RecommendationOutcome, as: 'outcome' }] });
    expect(actionWithOutcome.outcome.id).toBe(outcome.id);

    const outcomeWithParents = await RecommendationOutcome.findByPk(outcome.id, {
      include: [
        { model: AgentRecommendation, as: 'recommendation' },
        { model: RecommendationAction, as: 'action' },
      ],
    });
    expect(outcomeWithParents.recommendation.id).toBe(rec.id);
    expect(outcomeWithParents.action.id).toBe(action.id);
  });
});
