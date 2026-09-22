// backend/tests/unit/aiProviderParity.test.js
'use strict';

/**
 * Phase B: provider-parity and knowledge-portability tests.
 *
 * Proves that services/agents/runAgentTurn.js's provider-neutral contract
 * (`{stopReason, text, toolUses, rawAssistantContent}` from runAgentStep;
 * `{raw, parsed}` from analyzeKnowledgeSample) is honestly satisfied by BOTH
 * AnthropicProvider (unmodified, still the default) and the new
 * OpenAIProvider methods — without asserting the natural-language text is
 * identical, only that the structure/semantics match.
 *
 * No real network calls: both providers are constructed with a fake `client`
 * (a real, existing constructor test seam — see AnthropicProvider/
 * OpenAIProvider's own JSDoc: "Pre-built SDK client, for tests"), and
 * BaseProvider's retry policy is exercised with injected `sleep`/`random` (a
 * real, existing test seam — see BaseProvider.js's own header comment) so
 * retry tests run instantly instead of spending real seconds.
 */

const { AnthropicProvider } = require('../../src/services/ai/AnthropicProvider');
const { OpenAIProvider } = require('../../src/services/ai/OpenAIProvider');
const ApiError = require('../../src/utils/ApiError');

const NOOP_SLEEP = () => Promise.resolve();
const ZERO_RANDOM = () => 0;

const SHARED_TOOLS = [
  {
    name: 'get_thing',
    description: 'Reads a thing.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
];
const SHARED_MESSAGES = [{ role: 'user', content: 'please get thing 42' }];
const SHARED_SYSTEM_PROMPT = 'You are a test agent.';

function anthropicClient({ toolUse } = {}) {
  return {
    messages: {
      create: jest.fn().mockResolvedValue(
        toolUse
          ? {
              stop_reason: 'tool_use',
              content: [{ type: 'tool_use', id: 'anthropic_tu_1', name: 'get_thing', input: { id: '42' } }],
            }
          : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here is the thing.' }] }
      ),
    },
  };
}

function openaiClient({ toolUse } = {}) {
  return {
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [
            {
              message: toolUse
                ? { role: 'assistant', content: null, tool_calls: [{ id: 'openai_tu_1', type: 'function', function: { name: 'get_thing', arguments: '{"id":"42"}' } }] }
                : { role: 'assistant', content: 'Here is the thing.', tool_calls: [] },
            },
          ],
        }),
      },
    },
  };
}

describe('Model-switch test — same request/tools through both providers, compatible normalized shape', () => {
  test('a tool-call step: both providers report stopReason "tool_use" with the same tool name/input shape', async () => {
    const anthropic = new AnthropicProvider({ client: anthropicClient({ toolUse: true }), sleep: NOOP_SLEEP, random: ZERO_RANDOM });
    const openai = new OpenAIProvider({ client: openaiClient({ toolUse: true }), sleep: NOOP_SLEEP, random: ZERO_RANDOM });

    const anthropicStep = await anthropic.runAgentStep({ systemPrompt: SHARED_SYSTEM_PROMPT, tools: SHARED_TOOLS, messages: SHARED_MESSAGES });
    const openaiStep = await openai.runAgentStep({ systemPrompt: SHARED_SYSTEM_PROMPT, tools: SHARED_TOOLS, messages: SHARED_MESSAGES });

    for (const step of [anthropicStep, openaiStep]) {
      expect(step.stopReason).toBe('tool_use');
      expect(step.toolUses).toHaveLength(1);
      expect(step.toolUses[0]).toMatchObject({ name: 'get_thing', input: { id: '42' } });
      expect(typeof step.toolUses[0].id).toBe('string');
      expect(step.rawAssistantContent).toBeTruthy();
    }
  });

  test('a final-text step: both providers report a non-tool_use stopReason and the reply text', async () => {
    const anthropic = new AnthropicProvider({ client: anthropicClient({ toolUse: false }), sleep: NOOP_SLEEP, random: ZERO_RANDOM });
    const openai = new OpenAIProvider({ client: openaiClient({ toolUse: false }), sleep: NOOP_SLEEP, random: ZERO_RANDOM });

    const anthropicStep = await anthropic.runAgentStep({ systemPrompt: SHARED_SYSTEM_PROMPT, tools: SHARED_TOOLS, messages: SHARED_MESSAGES });
    const openaiStep = await openai.runAgentStep({ systemPrompt: SHARED_SYSTEM_PROMPT, tools: SHARED_TOOLS, messages: SHARED_MESSAGES });

    for (const step of [anthropicStep, openaiStep]) {
      expect(step.stopReason).not.toBe('tool_use');
      expect(step.toolUses).toEqual([]);
      expect(step.text).toBe('Here is the thing.');
    }
  });
});

describe('Full multi-step tool loop through OpenAIProvider via the real runAgentTurn.js orchestrator', () => {
  jest.mock('../../src/models', () => {
    const { Sequelize } = require('sequelize');
    const sqlite = new Sequelize('sqlite::memory:', { logging: false });
    const AgentActivity = require('../../src/models/agentActivity')(sqlite);
    const AgentKnowledge = require('../../src/models/agentKnowledge')(sqlite);
    const AgentKnowledgeUsage = require('../../src/models/agentKnowledgeUsage')(sqlite);
    const ScripturaSettings = require('../../src/models/scripturaSettings')(sqlite);
    return { AgentActivity, AgentKnowledge, AgentKnowledgeUsage, ScripturaSettings, sequelize: sqlite, Sequelize };
  });

  const mockOpenaiReadTool = {
    name: 'get_thing',
    description: 'Reads a thing.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } } },
    execute: jest.fn().mockResolvedValue({ type: 'read', thing: { id: '42', label: 'a thing' } }),
  };

  jest.mock('../../src/services/agents/registry', () => {
    const { AGENT_NAMES: NAMES } = require('../../src/constants');
    return {
      [NAMES.RESEARCH]: {
        name: NAMES.RESEARCH,
        systemPrompt: 'You are a test agent for the OpenAI parity test.',
        tools: [mockOpenaiReadTool],
      },
    };
  });

  let runAgentTurn;
  let setProviders;
  let resetProviders;
  let AGENT_NAMES;
  let sequelize;

  beforeAll(async () => {
    ({ runAgentTurn } = require('../../src/services/agents/runAgentTurn'));
    ({ setProviders, resetProviders } = require('../../src/services/ai'));
    ({ AGENT_NAMES } = require('../../src/constants'));
    ({ sequelize } = require('../../src/models'));
    await sequelize.sync({ force: true });
  });

  afterEach(() => {
    resetProviders();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test('OpenAIProvider drives a real tool-call -> tool-result -> final-reply turn, tool never touches OpenAI directly', async () => {
    const client = {
      chat: {
        completions: {
          create: jest
            .fn()
            .mockResolvedValueOnce({
              choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_thing', arguments: '{"id":"42"}' } }] } }],
            })
            .mockResolvedValueOnce({
              choices: [{ message: { role: 'assistant', content: 'The thing is: a thing.', tool_calls: [] } }],
            }),
        },
      },
    };
    setProviders({ text: new OpenAIProvider({ client, sleep: NOOP_SLEEP, random: ZERO_RANDOM }) });

    const result = await runAgentTurn({ agentName: AGENT_NAMES.RESEARCH, message: 'what is thing 42?' });

    expect(mockOpenaiReadTool.execute).toHaveBeenCalledWith({ id: '42' }, expect.any(Object));
    expect(result.reply).toBe('The thing is: a thing.');
    expect(result.toolCalls).toEqual([
      expect.objectContaining({ name: 'get_thing', result: { type: 'read', thing: { id: '42', label: 'a thing' } } }),
    ]);

    // The second OpenAI call must have received the tool result as a proper
    // OpenAI `role: 'tool'` message, translated from runAgentTurn.js's
    // Anthropic-shaped tool_result batch.
    const secondCallBody = client.chat.completions.create.mock.calls[1][0];
    const toolMsg = secondCallBody.messages.find((m) => m.role === 'tool');
    expect(toolMsg.tool_call_id).toBe('c1');
    expect(JSON.parse(toolMsg.content)).toEqual({ type: 'read', thing: { id: '42', label: 'a thing' } });
  });
});

describe('Malformed provider response handling', () => {
  test('OpenAIProvider throws a clear upstream error on unparseable tool-call arguments', async () => {
    const client = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_thing', arguments: '{not valid json' } }] } }],
          }),
        },
      },
    };
    const provider = new OpenAIProvider({ client, sleep: NOOP_SLEEP, random: ZERO_RANDOM });

    await expect(
      provider.runAgentStep({ systemPrompt: SHARED_SYSTEM_PROMPT, tools: SHARED_TOOLS, messages: SHARED_MESSAGES })
    ).rejects.toThrow(/malformed tool-call arguments/);
  });

  test('OpenAIProvider throws when the response has no message at all', async () => {
    const client = { chat: { completions: { create: jest.fn().mockResolvedValue({ choices: [] }) } } };
    const provider = new OpenAIProvider({ client, sleep: NOOP_SLEEP, random: ZERO_RANDOM });

    await expect(
      provider.runAgentStep({ systemPrompt: SHARED_SYSTEM_PROMPT, tools: SHARED_TOOLS, messages: SHARED_MESSAGES })
    ).rejects.toThrow(ApiError);
  });
});

describe('Provider error / retry behavior (BaseProvider.withRetry, inherited unchanged)', () => {
  test('a retryable error (429) is retried and eventually succeeds', async () => {
    const rateLimitError = Object.assign(new Error('rate limited'), { status: 429 });
    const create = jest
      .fn()
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce({ choices: [{ message: { role: 'assistant', content: 'ok', tool_calls: [] } }] });
    const client = { chat: { completions: { create } } };
    const provider = new OpenAIProvider({ client, sleep: NOOP_SLEEP, random: ZERO_RANDOM });

    const step = await provider.runAgentStep({ systemPrompt: SHARED_SYSTEM_PROMPT, tools: SHARED_TOOLS, messages: SHARED_MESSAGES });

    expect(create).toHaveBeenCalledTimes(2);
    expect(step.text).toBe('ok');
  });

  test('a non-retryable error (400) fails immediately, no retry attempted', async () => {
    const badRequestError = Object.assign(new Error('bad request'), { status: 400 });
    const create = jest.fn().mockRejectedValue(badRequestError);
    const client = { chat: { completions: { create } } };
    const provider = new OpenAIProvider({ client, sleep: NOOP_SLEEP, random: ZERO_RANDOM });

    await expect(
      provider.runAgentStep({ systemPrompt: SHARED_SYSTEM_PROMPT, tools: SHARED_TOOLS, messages: SHARED_MESSAGES })
    ).rejects.toThrow(ApiError);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('Structured knowledge extraction parity (analyzeKnowledgeSample)', () => {
  const EXTRACTION_RESULT = { candidates: [{ category: 'seo', topic: 'x', claim: 'a claim', evidence: null, knowledge_type: 'fact' }] };

  test('OpenAIProvider.analyzeKnowledgeSample returns the same {raw, parsed} contract as AnthropicProvider', async () => {
    const anthropic = new AnthropicProvider({
      client: { messages: { create: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(EXTRACTION_RESULT) }] }) } },
      sleep: NOOP_SLEEP,
      random: ZERO_RANDOM,
    });
    const openai = new OpenAIProvider({
      client: { chat: { completions: { create: jest.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(EXTRACTION_RESULT) } }] }) } } },
      sleep: NOOP_SLEEP,
      random: ZERO_RANDOM,
    });

    const anthropicResult = await anthropic.analyzeKnowledgeSample({ systemPrompt: 'sys', textContent: 'source text' });
    const openaiResult = await openai.analyzeKnowledgeSample({ systemPrompt: 'sys', textContent: 'source text' });

    expect(anthropicResult.parsed).toEqual(EXTRACTION_RESULT);
    expect(openaiResult.parsed).toEqual(EXTRACTION_RESULT);
    expect(typeof anthropicResult.raw).toBe('string');
    expect(typeof openaiResult.raw).toBe('string');
  });

  test('OpenAIProvider.analyzeKnowledgeSample sends images as image_url content parts', async () => {
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(EXTRACTION_RESULT) } }] });
    const openai = new OpenAIProvider({ client: { chat: { completions: { create } } }, sleep: NOOP_SLEEP, random: ZERO_RANDOM });

    await openai.analyzeKnowledgeSample({
      systemPrompt: 'sys',
      textContent: 'caption',
      images: [{ mediaType: 'image/png', base64: 'ZmFrZQ==' }],
    });

    const body = create.mock.calls[0][0];
    const userContent = body.messages.find((m) => m.role === 'user').content;
    expect(userContent[0]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,ZmFrZQ==' } });
  });
});

describe('Knowledge portability — no provider-specific state in the schema', () => {
  test('agent_knowledge / knowledge_sources / source_chunks have no Claude/Anthropic/provider-specific columns', () => {
    const { Sequelize } = require('sequelize');
    const sqlite = new Sequelize('sqlite::memory:', { logging: false });
    const AgentKnowledge = require('../../src/models/agentKnowledge')(sqlite);
    const KnowledgeSource = require('../../src/models/knowledgeSource')(sqlite);
    const SourceChunk = require('../../src/models/sourceChunk')(sqlite);

    const suspiciousPattern = /claude|anthropic|openai|gpt|gemini|message_id|tool_use_id|tool_call_id/i;

    for (const Model of [AgentKnowledge, KnowledgeSource, SourceChunk]) {
      const attributeNames = Object.keys(Model.rawAttributes);
      const offending = attributeNames.filter((name) => suspiciousPattern.test(name));
      expect(offending).toEqual([]);

      // ENUM value check too — e.g. a status/source_type value must not name a provider.
      for (const name of attributeNames) {
        const attr = Model.rawAttributes[name];
        const enumValues = attr.values || attr.type?.values;
        if (Array.isArray(enumValues)) {
          const offendingValues = enumValues.filter((v) => suspiciousPattern.test(String(v)));
          expect(offendingValues).toEqual([]);
        }
      }
    }
  });
});
