// backend/tests/unit/recommendationEffectivenessTool.test.js
'use strict';

/**
 * P3-B tests: the get_recommendation_effectiveness SEO Analyst tool — the
 * tool must return exactly what recommendationEvaluation.js (P3-A) computed,
 * never inventing or adjusting a number. Same in-memory SQLite pattern as
 * every prior P2/P3 test file. No real DB or network touched, no AI
 * provider call anywhere in this path.
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
const { TOOLS } = require('../../src/services/agents/tools/seoAnalystAgentTools');

const tool = TOOLS.find((t) => t.name === 'get_recommendation_effectiveness');

let n = 0;
async function seedOutcome({ actionType = 'blog.update_seo_fields', outcome }) {
  n += 1;
  const rec = await AgentRecommendation.create({
    trace_id: `trace-${n}`,
    agent_name: AGENT_NAMES.SEO_ANALYST,
    recommendation_type: 'recommend_seo_action',
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
    status: 'evaluated',
    outcome,
    evaluated_at: new Date(),
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

test('the tool is registered on the SEO Analyst agent', () => {
  expect(tool).toBeDefined();
  expect(tool.name).toBe('get_recommendation_effectiveness');
});

test('returns exactly what recommendationEvaluation.js computed — real counts, no invented numbers', async () => {
  await seedOutcome({ outcome: 'improved' });
  await seedOutcome({ outcome: 'improved' });
  await seedOutcome({ outcome: 'declined' });

  const result = await tool.execute({ action_type: 'blog.update_seo_fields' });

  expect(result.type).toBe('read');
  expect(result.group_by).toBe('action_type');
  expect(result.breakdown).toHaveLength(1);
  expect(result.breakdown[0]).toMatchObject({
    dimension_value: 'blog.update_seo_fields',
    sample_size: 3,
    improved: 2,
    declined: 1,
    neutral: 0,
    inconclusive: 0,
    confidence_note: 'insufficient_sample', // below MIN_SAMPLE_SIZE_FOR_RATE (5)
  });
  expect(result.breakdown[0].improved_rate).toBeNull();
});

test('an empty result set returns an empty breakdown, never a fabricated row', async () => {
  const result = await tool.execute({ action_type: 'blog.update_seo_fields' });
  expect(result.breakdown).toEqual([]);
});

test('filters_applied echoes back exactly what was passed, nothing invented', async () => {
  const result = await tool.execute({ action_type: 'blog.update_block', agent_name: AGENT_NAMES.SEO_ANALYST });
  expect(result.filters_applied).toEqual({
    action_type: 'blog.update_block',
    recommendation_type: null,
    agent_name: AGENT_NAMES.SEO_ANALYST,
    since_date: null,
  });
});

test('group_by:"recommendation_type" is passed through correctly', async () => {
  await seedOutcome({ outcome: 'improved' });
  const result = await tool.execute({ group_by: 'recommendation_type' });
  expect(result.group_by).toBe('recommendation_type');
  expect(result.breakdown[0].dimension_value).toBe('recommend_seo_action');
});

test('no AI provider call happens anywhere in this tool execution path', () => {
  // Static guarantee, not a runtime spy: confirms this file (and its one
  // dependency, recommendationEvaluation.js) never references a provider.
  const toolSource = require('fs').readFileSync(
    require.resolve('../../src/services/agents/tools/seoAnalystAgentTools.js'),
    'utf8'
  );
  const evalSource = require('fs').readFileSync(
    require.resolve('../../src/services/agents/recommendationEvaluation.js'),
    'utf8'
  );
  expect(toolSource + evalSource).not.toMatch(/runAgentStep|getTextProvider|anthropic|openai/i);
});
