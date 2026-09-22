// backend/tests/unit/seoRecommendation.test.js
'use strict';

/**
 * Tests for the SEO Analyst structured recommendation capability:
 * sharedRecommendationTools.js's recommend_seo_action tool, and its capture
 * via the new `type:'recommendation'` branch in runAgentTurn.js (reusing
 * P0's recordRecommendation()/agent_recommendations unchanged).
 *
 * Isolation: same pattern as agentRecommendations.test.js / P0's tests —
 * in-memory SQLite via mocked `../../src/models`, mocked registry with the
 * REAL recommend_seo_action tool (production code, not a test double) plus
 * simple test-double read/proposed_change tools to prove coexistence, no
 * real DB/network touched.
 */

const { makeRecommendationTools } = require('../../src/services/agents/tools/sharedRecommendationTools');
const { AGENT_NAMES } = require('../../src/constants');

// ---------------------------------------------------------------------------
// Part 1: the tool's own contract, in isolation (no DB, no orchestration)
// ---------------------------------------------------------------------------
describe('recommend_seo_action tool contract', () => {
  const [recommendSeoAction] = makeRecommendationTools(AGENT_NAMES.SEO_ANALYST);

  test('1. returns type:"recommendation", never "proposed_change"', async () => {
    const result = await recommendSeoAction.execute({
      recommendation: 'Add an FAQ section to Article #42.',
      rationale: 'Position #7 with no FAQ coverage; competitors ranking above it all have one.',
    });
    expect(result.type).toBe('recommendation');
    expect(result.type).not.toBe('proposed_change');
  });

  test('2. a minimal call with only recommendation+rationale succeeds', async () => {
    const result = await recommendSeoAction.execute({
      recommendation: 'Refresh the Mercury Retrograde article.',
      rationale: 'Ranking data is over three weeks old.',
    });
    expect(result.change.recommendation).toBe('Refresh the Mercury Retrograde article.');
    expect(result.change.rationale).toBe('Ranking data is over three weeks old.');
  });

  test('3. every prediction field is optional and defaults to null when omitted', async () => {
    const result = await recommendSeoAction.execute({ recommendation: 'x', rationale: 'y' });
    expect(result.change.expected_metric).toBeNull();
    expect(result.change.expected_direction).toBeNull();
    expect(result.change.expected_change).toBeNull();
    expect(result.change.observation_window_days).toBeNull();
    expect(result.change.confidence).toBeNull();
  });

  test('prediction fields are stored correctly when provided', async () => {
    const result = await recommendSeoAction.execute({
      recommendation: 'x',
      rationale: 'y',
      expected_metric: 'gsc_impressions',
      expected_direction: 'increase',
      expected_change: 20,
      observation_window_days: 30,
      confidence: 0.65,
    });
    expect(result.change).toMatchObject({
      expected_metric: 'gsc_impressions',
      expected_direction: 'increase',
      expected_change: 20,
      observation_window_days: 30,
      confidence: 0.65,
    });
  });

  test('4. evidence_refs are preserved verbatim (well-formed entries)', async () => {
    const evidenceRefs = [
      { type: 'serp_snapshot', id: 2 },
      { type: 'gsc_snapshot', id: 5 },
      { type: 'agent_knowledge', id: 17 },
      { type: 'agent_knowledge_usage', trace_id: 'trace-abc' },
    ];
    const result = await recommendSeoAction.execute({ recommendation: 'x', rationale: 'y', evidence_refs: evidenceRefs });
    expect(result.change.evidence_refs).toEqual(evidenceRefs);
  });

  test('malformed evidence_refs entries are dropped, not fatal', async () => {
    const result = await recommendSeoAction.execute({
      recommendation: 'x',
      rationale: 'y',
      evidence_refs: [
        { type: 'serp_snapshot', id: 2 },
        { type: 'not_a_real_type', id: 99 },
        { type: 'agent_knowledge' }, // missing id
        'not even an object',
      ],
    });
    expect(result.change.evidence_refs).toEqual([{ type: 'serp_snapshot', id: 2 }]);
  });

  test('target_ref identifiers are spread onto the top level of change, matching every other tool', async () => {
    const result = await recommendSeoAction.execute({
      recommendation: 'x',
      rationale: 'y',
      target_ref: { blog_id: 42, keyword: 'mercury retrograde', page_url: 'https://divinetalk.in/mercury' },
    });
    expect(result.change.blog_id).toBe(42);
    expect(result.change.keyword).toBe('mercury retrograde');
    expect(result.change.page_url).toBe('https://divinetalk.in/mercury');
  });

  test('missing recommendation or rationale throws', async () => {
    await expect(recommendSeoAction.execute({ rationale: 'y' })).rejects.toThrow(/recommendation is required/);
    await expect(recommendSeoAction.execute({ recommendation: 'x' })).rejects.toThrow(/rationale is required/);
  });
});

// ---------------------------------------------------------------------------
// Part 2: capture via runAgentTurn.js, real recommend_seo_action + test-double
// read/proposed_change tools to prove coexistence and non-interference.
// ---------------------------------------------------------------------------
const mockReadTool = {
  name: 'test_read_tool',
  description: 'read',
  input_schema: { type: 'object', properties: {} },
  execute: jest.fn().mockResolvedValue({ type: 'read', data: 'x' }),
};
const mockProposeTool = {
  name: 'test_propose_tool',
  description: 'propose',
  input_schema: { type: 'object', properties: {} },
  execute: jest.fn().mockResolvedValue({
    type: 'proposed_change',
    change: { key: 'x.setting', current_value: 'old', proposed_value: 'new' },
    message: 'proposed',
  }),
};

jest.mock('../../src/models', () => {
  const { Sequelize } = require('sequelize');
  const sqlite = new Sequelize('sqlite::memory:', { logging: false });
  const AgentActivity = require('../../src/models/agentActivity')(sqlite);
  const AgentRecommendation = require('../../src/models/agentRecommendation')(sqlite);
  AgentRecommendation.belongsTo(AgentActivity, { foreignKey: 'source_activity_id', as: 'sourceActivity', constraints: false });
  return { AgentActivity, AgentRecommendation, sequelize: sqlite, Sequelize };
});

jest.mock('../../src/services/agents/registry', () => {
  const { AGENT_NAMES: NAMES } = require('../../src/constants');
  const { makeRecommendationTools: makeRealRecommendationTools } = require('../../src/services/agents/tools/sharedRecommendationTools');
  return {
    [NAMES.SEO_ANALYST]: {
      name: NAMES.SEO_ANALYST,
      systemPrompt: 'You are a test SEO Analyst agent.',
      tools: [mockReadTool, mockProposeTool, ...makeRealRecommendationTools(NAMES.SEO_ANALYST)],
    },
  };
});

const { runAgentTurn } = require('../../src/services/agents/runAgentTurn');
const { setProviders, resetProviders } = require('../../src/services/ai');
const { AgentActivity, AgentRecommendation, sequelize } = require('../../src/models');

function textStep(text) {
  return { stopReason: 'end_turn', text, toolUses: [], rawAssistantContent: [{ type: 'text', text }] };
}
function toolUseStep(name, input = {}, id = `tu_${Math.random().toString(36).slice(2)}`) {
  return { stopReason: 'tool_use', text: null, toolUses: [{ id, name, input }], rawAssistantContent: [{ type: 'tool_use', id, name, input }] };
}

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  await AgentRecommendation.destroy({ truncate: true });
  await AgentActivity.destroy({ truncate: true });
  resetProviders();
  jest.clearAllMocks();
});

afterAll(async () => {
  await sequelize.close();
});

describe('Capture via runAgentTurn.js', () => {
  test('5. a real recommend_seo_action call is persisted into agent_recommendations', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('recommend_seo_action', { recommendation: 'Add FAQ to Article #42.', rationale: 'Gap in coverage vs. competitors.' }, 'tu_1'))
      .mockResolvedValueOnce(textStep('Here is my recommendation.'));
    setProviders({ text: { runAgentStep } });

    const result = await runAgentTurn({ agentName: AGENT_NAMES.SEO_ANALYST, message: 'recommend something' });

    expect(await AgentRecommendation.count()).toBe(1);
    const row = await AgentRecommendation.findOne();
    expect(row.recommendation_type).toBe('recommend_seo_action');
    expect(row.status).toBe('recommended');
    expect(row.recommendation_details.recommendation).toBe('Add FAQ to Article #42.');
    expect(result.reply).toBe('Here is my recommendation.'); // prose reply still produced — see test 12b
  });

  test('6. the recommendation is NOT added to proposedChanges (no phantom Apply button)', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('recommend_seo_action', { recommendation: 'x', rationale: 'y' }, 'tu_2'))
      .mockResolvedValueOnce(textStep('done'));
    setProviders({ text: { runAgentStep } });

    const result = await runAgentTurn({ agentName: AGENT_NAMES.SEO_ANALYST, message: 'x' });
    expect(result.proposedChanges).toEqual([]);
  });

  test('7. the recommendation does NOT trigger a setting_proposed activity event', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('recommend_seo_action', { recommendation: 'x', rationale: 'y' }, 'tu_3'))
      .mockResolvedValueOnce(textStep('done'));
    setProviders({ text: { runAgentStep } });

    await runAgentTurn({ agentName: AGENT_NAMES.SEO_ANALYST, message: 'x' });
    const settingProposedRow = await AgentActivity.findOne({ where: { event_type: 'setting_proposed' } });
    expect(settingProposedRow).toBeNull();
    const toolCallRow = await AgentActivity.findOne({ where: { event_type: 'tool_call' } });
    expect(toolCallRow).not.toBeNull(); // the ordinary tool_call event still fires, as for any tool
  });

  test('8. ordinary read-only tool output remains uncaptured', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('test_read_tool', {}, 'tu_4'))
      .mockResolvedValueOnce(textStep('done'));
    setProviders({ text: { runAgentStep } });

    await runAgentTurn({ agentName: AGENT_NAMES.SEO_ANALYST, message: 'x' });
    expect(await AgentRecommendation.count()).toBe(0);
  });

  test('9. provider identity is never stored in the captured row', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('recommend_seo_action', { recommendation: 'x', rationale: 'y' }, 'tu_5'))
      .mockResolvedValueOnce(textStep('done'));
    setProviders({ text: { runAgentStep } });

    await runAgentTurn({ agentName: AGENT_NAMES.SEO_ANALYST, message: 'x' });
    const row = await AgentRecommendation.findOne();
    const serialized = JSON.stringify(row.toJSON());
    expect(serialized).not.toMatch(/claude|anthropic|openai|gpt-|tu_5/i);
  });

  test('10. no chain-of-thought / hidden reasoning is stored — only the tool\'s own structured output', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('recommend_seo_action', { recommendation: 'x', rationale: 'y' }, 'tu_6'))
      .mockResolvedValueOnce(textStep('done'));
    setProviders({ text: { runAgentStep } });

    await runAgentTurn({ agentName: AGENT_NAMES.SEO_ANALYST, message: 'x' });
    const row = await AgentRecommendation.findOne();
    // The stored details are exactly the tool's own returned `change` object —
    // no `rawAssistantContent`/`thinking`/provider-response fields exist anywhere on it.
    expect(Object.keys(row.recommendation_details).sort()).toEqual(
      ['action', 'confidence', 'current_value', 'domain', 'evidence_refs', 'expected_change', 'expected_direction', 'expected_metric', 'observation_window_days', 'proposed_value', 'rationale', 'recommendation'].sort()
    );
  });

  test('11. tool-call-based idempotency: a duplicate call for the same tool_call activity row does not duplicate', async () => {
    const activityRow = await AgentActivity.create({
      trace_id: 't-dup',
      agent_name: AGENT_NAMES.SEO_ANALYST,
      event_type: 'tool_call',
      status: 'success',
      tool_name: 'recommend_seo_action',
      payload: {},
    });
    const { recordRecommendation } = require('../../src/services/agents/recommendations');
    const args = {
      traceId: 't-dup',
      agentName: AGENT_NAMES.SEO_ANALYST,
      sourceActivityId: activityRow.id,
      toolName: 'recommend_seo_action',
      change: { recommendation: 'x', rationale: 'y' },
      message: 'x',
    };
    await recordRecommendation(args);
    await recordRecommendation(args);
    expect(await AgentRecommendation.count()).toBe(1);
  });
});

describe('Existing proposed_change behavior unchanged', () => {
  test('12. a proposed_change tool call still works exactly as before, unaffected by the new branch', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('test_propose_tool', {}, 'tu_7'))
      .mockResolvedValueOnce(textStep('proposal made'));
    setProviders({ text: { runAgentStep } });

    const result = await runAgentTurn({ agentName: AGENT_NAMES.SEO_ANALYST, message: 'x' });

    expect(result.proposedChanges).toEqual([{ key: 'x.setting', current_value: 'old', proposed_value: 'new' }]);
    const settingProposedRow = await AgentActivity.findOne({ where: { event_type: 'setting_proposed' } });
    expect(settingProposedRow).not.toBeNull();
    // The proposed_change path is still captured via P0's mechanism too.
    const rec = await AgentRecommendation.findOne();
    expect(rec.recommendation_type).toBe('test_propose_tool');
  });

  test('12b. a turn with a recommendation and a normal read still produces a coherent final prose reply', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('test_read_tool', {}, 'tu_8a'))
      .mockResolvedValueOnce(toolUseStep('recommend_seo_action', { recommendation: 'x', rationale: 'y' }, 'tu_8b'))
      .mockResolvedValueOnce(textStep('Full analysis with a recommendation.'));
    setProviders({ text: { runAgentStep } });

    const result = await runAgentTurn({ agentName: AGENT_NAMES.SEO_ANALYST, message: 'x' });
    expect(result.reply).toBe('Full analysis with a recommendation.');
    expect(await AgentRecommendation.count()).toBe(1);
  });
});
