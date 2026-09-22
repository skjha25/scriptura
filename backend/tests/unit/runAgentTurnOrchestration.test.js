// backend/tests/unit/runAgentTurnOrchestration.test.js
'use strict';

/**
 * Regression tests for services/agents/runAgentTurn.js — the tool-use loop,
 * activity logging, proposed-change collection, delegation, prior-message
 * replay, and knowledge injection. Verifies EXISTING behavior; this file
 * does not modify runAgentTurn.js or any tool.
 *
 * Isolation: same pattern as the other Phase A files — in-memory SQLite via
 * mocked `../../src/models`, no real DB touched.
 *
 * Provider control uses services/ai/index.js's own `setProviders`/
 * `resetProviders` — a real, existing test seam already documented in that
 * file ("Narrow escape hatch for integration tests that need a provider
 * which fails on demand... Production code never calls it"), not something
 * added for this test. No AI SDK is mocked; a plain fake object implementing
 * `runAgentStep` stands in for Claude/OpenAI.
 *
 * The registry is mocked with two agents: `chief_agent` uses the REAL
 * chiefAgentTools.js delegate_to_agent tool (so delegation mechanics are
 * exercised for real), delegating to `research_agent`, which is given
 * simple test-double tools (not the real, business-specific research tools)
 * so tool-execution mechanics are tested in isolation from any one agent's
 * real business logic.
 */

jest.mock('../../src/models', () => {
  const { Sequelize } = require('sequelize');
  const sqlite = new Sequelize('sqlite::memory:', { logging: false });
  const AgentActivity = require('../../src/models/agentActivity')(sqlite);
  const AgentKnowledge = require('../../src/models/agentKnowledge')(sqlite);
  const AgentKnowledgeUsage = require('../../src/models/agentKnowledgeUsage')(sqlite);
  const ScripturaSettings = require('../../src/models/scripturaSettings')(sqlite);
  return { AgentActivity, AgentKnowledge, AgentKnowledgeUsage, ScripturaSettings, sequelize: sqlite, Sequelize };
});

const { AGENT_NAMES } = require('../../src/constants');
const chiefAgentTools = require('../../src/services/agents/tools/chiefAgentTools');

// Prefixed with "mock" so jest's hoisted jest.mock() factory below is
// permitted to reference them (babel-plugin-jest-hoist's documented
// exception — see its error message if this prefix is dropped).
const mockReadTool = {
  name: 'test_read_tool',
  description: 'A test read-only tool.',
  input_schema: { type: 'object', properties: {} },
  execute: jest.fn().mockResolvedValue({ type: 'read', data: 'some read result' }),
};

const mockProposeTool = {
  name: 'test_propose_tool',
  description: 'A test proposed_change tool.',
  input_schema: { type: 'object', properties: {} },
  execute: jest.fn().mockResolvedValue({
    type: 'proposed_change',
    change: { domain: 'test', key: 'test.setting', current_value: 'old', proposed_value: 'new' },
  }),
};

const mockThrowingTool = {
  name: 'test_throwing_tool',
  description: 'A test tool that always fails.',
  input_schema: { type: 'object', properties: {} },
  execute: jest.fn().mockRejectedValue(new Error('tool exploded')),
};

jest.mock('../../src/services/agents/registry', () => {
  const { AGENT_NAMES: NAMES } = require('../../src/constants');
  const chief = require('../../src/services/agents/tools/chiefAgentTools');
  return {
    [NAMES.CHIEF]: {
      name: NAMES.CHIEF,
      systemPrompt: 'You are a test Chief agent.',
      tools: chief.TOOLS,
    },
    [NAMES.RESEARCH]: {
      name: NAMES.RESEARCH,
      systemPrompt: 'You are a test Research agent persona for knowledge injection.',
      tools: [mockReadTool, mockProposeTool, mockThrowingTool],
    },
  };
});

const { runAgentTurn, MAX_TOOL_CALLS_PER_TURN } = require('../../src/services/agents/runAgentTurn');
const { setProviders, resetProviders } = require('../../src/services/ai');
const { AgentActivity, AgentKnowledge, sequelize } = require('../../src/models');

function textStep(text) {
  return { stopReason: 'end_turn', text, toolUses: [], rawAssistantContent: [{ type: 'text', text }] };
}

function toolUseStep(name, input = {}, id = `tu_${Math.random().toString(36).slice(2)}`) {
  return {
    stopReason: 'tool_use',
    text: null,
    toolUses: [{ id, name, input }],
    rawAssistantContent: [{ type: 'tool_use', id, name, input }],
  };
}

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  await AgentActivity.destroy({ truncate: true });
  await AgentKnowledge.destroy({ truncate: true });
  resetProviders();
  jest.clearAllMocks();
});

afterAll(async () => {
  await sequelize.close();
});

describe('runAgentTurn — basic turn / text reply', () => {
  test('a text-only reply (no tool use) logs user_message + final_reply and returns the text', async () => {
    setProviders({ text: { runAgentStep: jest.fn().mockResolvedValue(textStep('Hello, how can I help?')) } });

    const result = await runAgentTurn({ agentName: AGENT_NAMES.RESEARCH, message: 'hi' });

    expect(result.reply).toBe('Hello, how can I help?');
    expect(result.toolCalls).toHaveLength(0);

    const rows = await AgentActivity.findAll({ where: { trace_id: result.traceId }, order: [['id', 'ASC']] });
    expect(rows.map((r) => r.event_type)).toEqual(['user_message', 'final_reply']);
  });
});

describe('runAgentTurn — tool execution', () => {
  test('a read tool result is fed back as a tool_result and logged as tool_call', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('test_read_tool', {}, 'tu_1'))
      .mockResolvedValueOnce(textStep('Here is what I found.'));
    setProviders({ text: { runAgentStep } });

    const result = await runAgentTurn({ agentName: AGENT_NAMES.RESEARCH, message: 'look something up' });

    expect(mockReadTool.execute).toHaveBeenCalledTimes(1);
    expect(result.toolCalls).toEqual([
      expect.objectContaining({ name: 'test_read_tool', result: { type: 'read', data: 'some read result' } }),
    ]);

    // Second runAgentStep call must have received the assistant tool_use turn
    // AND a matching tool_result batch, exactly as runAgentTurn.js builds it.
    const secondCallArgs = runAgentStep.mock.calls[1][0];
    const assistantMsg = secondCallArgs.messages.find((m) => m.role === 'assistant');
    const toolResultMsg = secondCallArgs.messages.find((m) => m.role === 'user' && Array.isArray(m.content));
    expect(assistantMsg).toBeDefined();
    expect(toolResultMsg.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1', is_error: false });

    const toolCallRow = await AgentActivity.findOne({ where: { trace_id: result.traceId, event_type: 'tool_call' } });
    expect(toolCallRow.tool_name).toBe('test_read_tool');
    expect(toolCallRow.status).toBe('success');
  });

  test('a proposed_change tool result is collected in proposedChanges and logged as setting_proposed', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('test_propose_tool', {}, 'tu_2'))
      .mockResolvedValueOnce(textStep('Proposed a change above.'));
    setProviders({ text: { runAgentStep } });

    const result = await runAgentTurn({ agentName: AGENT_NAMES.RESEARCH, message: 'change something' });

    expect(result.proposedChanges).toEqual([
      expect.objectContaining({ domain: 'test', key: 'test.setting', proposed_value: 'new' }),
    ]);
    const proposedRow = await AgentActivity.findOne({ where: { trace_id: result.traceId, event_type: 'setting_proposed' } });
    expect(proposedRow).not.toBeNull();
  });

  test('a throwing tool is caught, logged as an error, and the turn continues instead of crashing', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('test_throwing_tool', {}, 'tu_3'))
      .mockResolvedValueOnce(textStep('Sorry, that failed.'));
    setProviders({ text: { runAgentStep } });

    const result = await runAgentTurn({ agentName: AGENT_NAMES.RESEARCH, message: 'break something' });

    expect(result.reply).toBe('Sorry, that failed.');
    expect(result.toolCalls[0].result).toEqual({ type: 'error', error: 'tool exploded' });

    const errorRow = await AgentActivity.findOne({ where: { trace_id: result.traceId, event_type: 'error' } });
    expect(errorRow).not.toBeNull();
    const toolCallRow = await AgentActivity.findOne({ where: { trace_id: result.traceId, event_type: 'tool_call' } });
    expect(toolCallRow.status).toBe('failure');

    // The next runAgentStep call must have received an is_error:true tool_result.
    const secondCallArgs = runAgentStep.mock.calls[1][0];
    const toolResultMsg = secondCallArgs.messages.find((m) => m.role === 'user' && Array.isArray(m.content));
    expect(toolResultMsg.content[0].is_error).toBe(true);
  });

  test('a multi-step loop (tool -> tool -> text) calls the provider exactly 3 times', async () => {
    const runAgentStep = jest
      .fn()
      .mockResolvedValueOnce(toolUseStep('test_read_tool', {}, 'tu_a'))
      .mockResolvedValueOnce(toolUseStep('test_propose_tool', {}, 'tu_b'))
      .mockResolvedValueOnce(textStep('Done with both steps.'));
    setProviders({ text: { runAgentStep } });

    const result = await runAgentTurn({ agentName: AGENT_NAMES.RESEARCH, message: 'do two things' });

    expect(runAgentStep).toHaveBeenCalledTimes(3);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.reply).toBe('Done with both steps.');
  });

  test('a provider that never stops calling tools is capped at MAX_TOOL_CALLS_PER_TURN and falls back to the canned reply', async () => {
    const runAgentStep = jest.fn().mockImplementation(() => Promise.resolve(toolUseStep('test_read_tool', {})));
    setProviders({ text: { runAgentStep } });

    const result = await runAgentTurn({ agentName: AGENT_NAMES.RESEARCH, message: 'never stop' });

    expect(runAgentStep).toHaveBeenCalledTimes(MAX_TOOL_CALLS_PER_TURN);
    expect(result.toolCalls).toHaveLength(MAX_TOOL_CALLS_PER_TURN);
    expect(result.reply).toMatch(/proposed changes above/i);
  });
});

describe('runAgentTurn — delegation (real chiefAgentTools.js delegate_to_agent)', () => {
  test('Chief delegating to Research: real delegation mechanics, sub-agent proposedChanges surfaced, both agents logged under one trace', async () => {
    const runAgentStep = jest
      .fn()
      // Chief's first step: delegate.
      .mockResolvedValueOnce(
        toolUseStep('delegate_to_agent', { agent_name: AGENT_NAMES.RESEARCH, instruction: 'propose a change' }, 'tu_del')
      )
      // Research sub-turn's first step: propose a change.
      .mockResolvedValueOnce(toolUseStep('test_propose_tool', {}, 'tu_sub'))
      // Research sub-turn's second step: final text.
      .mockResolvedValueOnce(textStep('Sub-agent done.'))
      // Chief's second step (after delegation tool_result): final text.
      .mockResolvedValueOnce(textStep('Delegated and relayed the result.'));
    setProviders({ text: { runAgentStep } });

    const result = await runAgentTurn({ agentName: AGENT_NAMES.CHIEF, message: 'please delegate this' });

    expect(result.reply).toBe('Delegated and relayed the result.');
    expect(result.proposedChanges).toEqual([
      expect.objectContaining({ domain: 'test', key: 'test.setting' }),
    ]);

    const rows = await AgentActivity.findAll({ where: { trace_id: result.traceId }, order: [['id', 'ASC']] });
    const eventsByAgent = rows.map((r) => `${r.agent_name}:${r.event_type}`);
    expect(eventsByAgent).toEqual(
      expect.arrayContaining([
        `${AGENT_NAMES.CHIEF}:user_message`,
        `${AGENT_NAMES.CHIEF}:delegation`,
        `${AGENT_NAMES.RESEARCH}:user_message`,
        `${AGENT_NAMES.RESEARCH}:tool_call`,
        `${AGENT_NAMES.RESEARCH}:final_reply`,
        `${AGENT_NAMES.CHIEF}:final_reply`,
      ])
    );
  });

  test('an agent cannot delegate to itself (defensive guard)', async () => {
    setProviders({ text: { runAgentStep: jest.fn() } });
    await expect(
      runAgentTurn({ agentName: AGENT_NAMES.CHIEF, message: 'x', fromAgent: AGENT_NAMES.CHIEF })
    ).rejects.toThrow(/cannot delegate to itself/);
  });
});

describe('runAgentTurn — conversation continuation', () => {
  test('prior user_message/final_reply rows for the same trace are replayed as plain {role, content} pairs', async () => {
    const traceId = 'fixed-trace-for-continuation-test';
    await AgentActivity.create({
      trace_id: traceId,
      agent_name: AGENT_NAMES.RESEARCH,
      event_type: 'user_message',
      status: 'info',
      payload: { message: 'earlier question' },
    });
    await AgentActivity.create({
      trace_id: traceId,
      agent_name: AGENT_NAMES.RESEARCH,
      event_type: 'final_reply',
      status: 'success',
      payload: { reply: 'earlier answer' },
    });

    const runAgentStep = jest.fn().mockResolvedValue(textStep('follow-up answer'));
    setProviders({ text: { runAgentStep } });

    await runAgentTurn({ agentName: AGENT_NAMES.RESEARCH, message: 'follow-up question', traceId });

    const firstCallArgs = runAgentStep.mock.calls[0][0];
    expect(firstCallArgs.messages).toEqual(
      expect.arrayContaining([
        { role: 'user', content: 'earlier question' },
        { role: 'assistant', content: 'earlier answer' },
        { role: 'user', content: 'follow-up question' },
      ])
    );
  });
});

describe('runAgentTurn — knowledge injection', () => {
  test('confirmed knowledge relevant to the message is stamped into the system prompt', async () => {
    await AgentKnowledge.create({
      scope: 'agent',
      agent_name: AGENT_NAMES.RESEARCH,
      category: 'seo',
      topic: 'astrology apps',
      claim: 'Long-tail astrology keywords convert better than short head terms.',
      source_type: 'manual_text',
      confidence: 0.8,
      status: 'confirmed',
    });

    const runAgentStep = jest.fn().mockResolvedValue(textStep('ok'));
    setProviders({ text: { runAgentStep } });

    await runAgentTurn({ agentName: AGENT_NAMES.RESEARCH, message: 'astrology keywords for a new article' });

    const systemPromptSent = runAgentStep.mock.calls[0][0].systemPrompt;
    expect(systemPromptSent).toContain('Long-tail astrology keywords convert better than short head terms.');
  });
});
