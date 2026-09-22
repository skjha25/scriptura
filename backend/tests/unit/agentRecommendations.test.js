// backend/tests/unit/agentRecommendations.test.js
'use strict';

/**
 * Regression tests for P0 of the Decision/Outcome/Evaluation architecture:
 * services/agents/recommendations.js's recordRecommendation(), and its hook
 * inside runAgentTurn.js. Verifies capture happens for genuine recommendations
 * (both the "settings" shape and the "entity mutation" shape found across
 * the 8 agents), never for read-only tool output, is idempotent, fails safe
 * on malformed input, and never stores provider-identifying data.
 *
 * Isolation: same pattern as runAgentTurnOrchestration.test.js — in-memory
 * SQLite via mocked `../../src/models` and a mocked registry with
 * test-double tools, no real DB touched. Provider control uses
 * services/ai/index.js's own setProviders/resetProviders test seam.
 */

const mockReadTool = {
  name: 'test_read_tool',
  description: 'A test read-only tool.',
  input_schema: { type: 'object', properties: {} },
  execute: jest.fn().mockResolvedValue({ type: 'read', data: 'some read result' }),
};

// Mirrors the "settings" shape (imageAgentTools/generateAgentTools/
// autopilotAgentTools): {key, current_value, proposed_value} — NO domain/action.
const mockSettingsShapeTool = {
  name: 'test_propose_setting',
  description: 'A test settings-shape proposed_change tool.',
  input_schema: { type: 'object', properties: {} },
  execute: jest.fn().mockResolvedValue({
    type: 'proposed_change',
    change: { key: 'agents.test.setting', current_value: 'old', proposed_value: 'new' },
    message: 'Proposed a new test setting — nothing has been applied yet.',
  }),
};

// Mirrors the "entity mutation" shape (clusterAgentTools/researchAgentTools):
// {domain, action, key, ...entity ids, current_value, proposed_value}.
const mockEntityShapeTool = {
  name: 'test_propose_entity_change',
  description: 'A test entity-mutation-shape proposed_change tool.',
  input_schema: { type: 'object', properties: {} },
  execute: jest.fn().mockResolvedValue({
    type: 'proposed_change',
    change: {
      domain: 'cluster',
      action: 'cluster.update_status',
      key: 'cluster.update_status',
      cluster_id: 7,
      current_value: 'planning',
      proposed_value: 'active',
    },
    message: 'Proposed changing cluster #7 status — nothing has been applied yet.',
  }),
};

jest.mock('../../src/models', () => {
  const { Sequelize } = require('sequelize');
  const sqlite = new Sequelize('sqlite::memory:', { logging: false });
  const AgentActivity = require('../../src/models/agentActivity')(sqlite);
  const AgentRecommendation = require('../../src/models/agentRecommendation')(sqlite);
  const AgentKnowledge = require('../../src/models/agentKnowledge')(sqlite);
  const ScripturaSettings = require('../../src/models/scripturaSettings')(sqlite);
  AgentRecommendation.belongsTo(AgentActivity, { foreignKey: 'source_activity_id', as: 'sourceActivity', constraints: false });
  return { AgentActivity, AgentRecommendation, AgentKnowledge, ScripturaSettings, sequelize: sqlite, Sequelize };
});

jest.mock('../../src/services/agents/registry', () => {
  const { AGENT_NAMES: NAMES } = require('../../src/constants');
  return {
    [NAMES.RESEARCH]: {
      name: NAMES.RESEARCH,
      systemPrompt: 'You are a test Research agent.',
      tools: [mockReadTool, mockSettingsShapeTool, mockEntityShapeTool],
    },
    [NAMES.CLUSTER]: {
      name: NAMES.CLUSTER,
      systemPrompt: 'You are a test Cluster agent.',
      tools: [mockEntityShapeTool],
    },
  };
});

const { AGENT_NAMES } = require('../../src/constants');
const { runAgentTurn } = require('../../src/services/agents/runAgentTurn');
const { recordRecommendation } = require('../../src/services/agents/recommendations');
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

describe('Capture happens for genuine recommendations, never for read-only tool output', () => {
  test('1. a recommendation is captured', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('test_propose_setting', {}, 'tu_1'))
      .mockResolvedValueOnce(textStep('done'));
    setProviders({ text: { runAgentStep } });

    await runAgentTurn({ agentName: AGENT_NAMES.RESEARCH, message: 'propose a setting' });

    expect(await AgentRecommendation.count()).toBe(1);
  });

  test('2. ordinary read-only tool output is NOT captured as a recommendation', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('test_read_tool', {}, 'tu_2'))
      .mockResolvedValueOnce(textStep('done'));
    setProviders({ text: { runAgentStep } });

    await runAgentTurn({ agentName: AGENT_NAMES.RESEARCH, message: 'just read something' });

    expect(await AgentRecommendation.count()).toBe(0);
  });

  test('3. a proposed SETTING change (key/current_value/proposed_value, no domain/action) is captured correctly', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('test_propose_setting', {}, 'tu_3'))
      .mockResolvedValueOnce(textStep('done'));
    setProviders({ text: { runAgentStep } });

    await runAgentTurn({ agentName: AGENT_NAMES.RESEARCH, message: 'propose a setting' });

    const row = await AgentRecommendation.findOne();
    expect(row.recommendation_type).toBe('test_propose_setting');
    expect(row.recommendation_details).toEqual({ key: 'agents.test.setting', current_value: 'old', proposed_value: 'new' });
    expect(row.summary).toBe('Proposed a new test setting — nothing has been applied yet.');
  });

  test('4. an ENTITY MUTATION proposal (domain/action/entity id) is captured correctly', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('test_propose_entity_change', {}, 'tu_4'))
      .mockResolvedValueOnce(textStep('done'));
    setProviders({ text: { runAgentStep } });

    await runAgentTurn({ agentName: AGENT_NAMES.RESEARCH, message: 'change cluster status' });

    const row = await AgentRecommendation.findOne();
    expect(row.recommendation_type).toBe('test_propose_entity_change');
    expect(row.recommendation_details).toMatchObject({ domain: 'cluster', action: 'cluster.update_status', cluster_id: 7 });
  });

  test('5. different agent names are handled and stored correctly', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('test_propose_entity_change', {}, 'tu_5a'))
      .mockResolvedValueOnce(textStep('done'));
    setProviders({ text: { runAgentStep } });
    await runAgentTurn({ agentName: AGENT_NAMES.CLUSTER, message: 'x' });

    const row = await AgentRecommendation.findOne();
    expect(row.agent_name).toBe(AGENT_NAMES.CLUSTER);
  });
});

describe('Field preservation', () => {
  test('6. trace_id is preserved', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('test_propose_setting', {}, 'tu_6'))
      .mockResolvedValueOnce(textStep('done'));
    setProviders({ text: { runAgentStep } });

    const result = await runAgentTurn({ agentName: AGENT_NAMES.RESEARCH, message: 'x', traceId: 'fixed-trace-6' });

    const row = await AgentRecommendation.findOne();
    expect(row.trace_id).toBe('fixed-trace-6');
    expect(row.trace_id).toBe(result.traceId);
  });

  test('7. source_activity_id is preserved and points at the real setting_proposed activity row', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('test_propose_setting', {}, 'tu_7'))
      .mockResolvedValueOnce(textStep('done'));
    setProviders({ text: { runAgentStep } });

    await runAgentTurn({ agentName: AGENT_NAMES.RESEARCH, message: 'x' });

    const row = await AgentRecommendation.findOne();
    expect(row.source_activity_id).toBeTruthy();
    const activityRow = await AgentActivity.findByPk(row.source_activity_id);
    expect(activityRow.event_type).toBe('setting_proposed');
  });

  test('8. recommendation_type is preserved as the tool name', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('test_propose_entity_change', {}, 'tu_8'))
      .mockResolvedValueOnce(textStep('done'));
    setProviders({ text: { runAgentStep } });
    await runAgentTurn({ agentName: AGENT_NAMES.RESEARCH, message: 'x' });
    expect((await AgentRecommendation.findOne()).recommendation_type).toBe('test_propose_entity_change');
  });

  test('9. target_ref is preserved when available (best-effort identifier extraction)', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('test_propose_entity_change', {}, 'tu_9'))
      .mockResolvedValueOnce(textStep('done'));
    setProviders({ text: { runAgentStep } });
    await runAgentTurn({ agentName: AGENT_NAMES.RESEARCH, message: 'x' });

    const row = await AgentRecommendation.findOne();
    expect(row.target_ref).toEqual({ key: 'cluster.update_status', cluster_id: 7 });
  });

  test('10. optional prediction fields remain optional (null when not provided by any current tool)', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('test_propose_setting', {}, 'tu_10'))
      .mockResolvedValueOnce(textStep('done'));
    setProviders({ text: { runAgentStep } });
    await runAgentTurn({ agentName: AGENT_NAMES.RESEARCH, message: 'x' });

    const row = await AgentRecommendation.findOne();
    expect(row.expected_metric).toBeNull();
    expect(row.expected_direction).toBeNull();
    expect(row.expected_change).toBeNull();
    expect(row.observation_window_days).toBeNull();
    expect(row.confidence).toBeNull();
    expect(row.status).toBe('recommended');
  });
});

describe('Idempotency and safety', () => {
  test('11. a duplicate call for the same source_activity_id does not create a duplicate row', async () => {
    const activityRow = await AgentActivity.create({
      trace_id: 't-dup',
      agent_name: AGENT_NAMES.RESEARCH,
      event_type: 'setting_proposed',
      status: 'info',
      setting_key: 'x',
      payload: {},
    });

    const args = {
      traceId: 't-dup',
      agentName: AGENT_NAMES.RESEARCH,
      sourceActivityId: activityRow.id,
      toolName: 'test_propose_setting',
      change: { key: 'x', current_value: 1, proposed_value: 2 },
      message: 'x',
    };
    await recordRecommendation(args);
    await recordRecommendation(args); // simulated retry of the same proposal event

    expect(await AgentRecommendation.count()).toBe(1);
  });

  test('12. malformed/incomplete input fails safely — no throw, no row created', async () => {
    await expect(recordRecommendation({})).resolves.toBeNull();
    await expect(recordRecommendation({ traceId: 't', agentName: AGENT_NAMES.RESEARCH })).resolves.toBeNull(); // missing toolName/change
    await expect(recordRecommendation({ traceId: 't', agentName: AGENT_NAMES.RESEARCH, toolName: 'x', change: 'not-an-object' })).resolves.toBeNull();
    expect(await AgentRecommendation.count()).toBe(0);
  });

  test('13. provider identity is never stored — no Claude/OpenAI/model/tool-call-id fields anywhere in the schema', () => {
    const suspiciousPattern = /claude|anthropic|openai|gpt|gemini|model_name|message_id|tool_use_id|tool_call_id/i;
    const attributeNames = Object.keys(AgentRecommendation.rawAttributes);
    expect(attributeNames.filter((name) => suspiciousPattern.test(name))).toEqual([]);
  });

  test('13b. a captured row\'s stored JSON contains no provider-identifying data for a real tool result', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('test_propose_setting', {}, 'tu_13'))
      .mockResolvedValueOnce(textStep('done'));
    setProviders({ text: { runAgentStep } });
    await runAgentTurn({ agentName: AGENT_NAMES.RESEARCH, message: 'x' });

    const row = await AgentRecommendation.findOne();
    const serialized = JSON.stringify(row.toJSON());
    expect(serialized).not.toMatch(/claude|anthropic|openai|gpt-|tu_13/i);
  });
});

describe('Existing behavior unchanged', () => {
  test('14. runAgentTurn\'s reply/toolCalls/proposedChanges are identical in shape to before this feature existed', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('test_propose_setting', {}, 'tu_14'))
      .mockResolvedValueOnce(textStep('All done.'));
    setProviders({ text: { runAgentStep } });

    const result = await runAgentTurn({ agentName: AGENT_NAMES.RESEARCH, message: 'x' });

    expect(result.reply).toBe('All done.');
    expect(result.toolCalls).toEqual([
      expect.objectContaining({ name: 'test_propose_setting', result: expect.objectContaining({ type: 'proposed_change' }) }),
    ]);
    expect(result.proposedChanges).toEqual([{ key: 'agents.test.setting', current_value: 'old', proposed_value: 'new' }]);
    // The existing setting_proposed audit event still fires exactly as before.
    const proposedRow = await AgentActivity.findOne({ where: { event_type: 'setting_proposed' } });
    expect(proposedRow).not.toBeNull();
  });

  test('a recommendation-capture failure never breaks the turn (best-effort contract)', async () => {
    const { AgentRecommendation: RealModel } = require('../../src/models');
    const createSpy = jest.spyOn(RealModel, 'create').mockRejectedValueOnce(new Error('db unavailable'));

    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('test_propose_setting', {}, 'tu_15'))
      .mockResolvedValueOnce(textStep('Still works.'));
    setProviders({ text: { runAgentStep } });

    const result = await runAgentTurn({ agentName: AGENT_NAMES.RESEARCH, message: 'x' });
    expect(result.reply).toBe('Still works.');

    createSpy.mockRestore();
  });
});
