'use strict';

/**
 * Tools available to the Autopilot Scheduler Agent.
 *
 * Scoped deliberately narrow — retry count, plus the chat context-window
 * size (an unrelated ops knob folded in here because it needed *some*
 * agent's "Normal Rule" propose/apply mechanism and none of the domain
 * agents fit — see project memory for that call). The cron cadence
 * (`AUTOPILOT_CRON`) is read once at process boot in server.js and isn't
 * wired to any DB setting at all; making it live-changeable needs dynamic
 * cron re-registration, out of scope for this pass (see the persona prompt,
 * which tells the model to say so if asked).
 *
 * Unlike every other write-capable agent in this app, these tools reuse the
 * SETTINGS-KEY shape (`{key, current_value, proposed_value}`), not the
 * entity-mutation `domain`/`action` shape — because each is a single scalar
 * with an existing right-sized mechanism (PUT /settings/autopilot) already
 * in place, and routing one integer through the heavier proposals/apply
 * endpoint would be unwarranted complexity.
 */

const {
  AGENT_CHAT_CONTEXT_EXCHANGES_KEY,
  AGENT_CHAT_CONTEXT_EXCHANGES_DEFAULT,
  AGENT_CHAT_CONTEXT_EXCHANGES_MIN,
  AGENT_CHAT_CONTEXT_EXCHANGES_MAX,
} = require('../../../constants');

const AUTOPILOT_MAX_RETRIES_KEY = 'autopilot.max_retries';
const MIN_RETRIES = 1;
const MAX_RETRIES_CEILING = 10;

const getCurrentRetryCount = {
  name: 'get_current_retry_count',
  description: 'Read the current number of times autopilot retries a failed generation before giving up.',
  input_schema: { type: 'object', properties: {} },
  async execute() {
    const { ScripturaSettings } = require('../../../models');
    const current = await ScripturaSettings.getValue(AUTOPILOT_MAX_RETRIES_KEY, { fallback: 3 });
    return { type: 'read', current };
  },
};

const proposeRetryCount = {
  name: 'propose_retry_count',
  description:
    'Propose a new retry count for autopilot — how many times a failed generation is retried before ' +
    'the keyword is marked failed for manual review. Only proposes a diff for the admin to review; ' +
    'never applies it.',
  input_schema: {
    type: 'object',
    properties: {
      max_retries: {
        type: 'integer',
        minimum: MIN_RETRIES,
        maximum: MAX_RETRIES_CEILING,
        description: `New retry count, between ${MIN_RETRIES} and ${MAX_RETRIES_CEILING}.`,
      },
    },
    required: ['max_retries'],
  },
  async execute({ max_retries } = {}) {
    if (!Number.isInteger(max_retries) || max_retries < MIN_RETRIES || max_retries > MAX_RETRIES_CEILING) {
      throw new Error(`max_retries must be an integer between ${MIN_RETRIES} and ${MAX_RETRIES_CEILING}.`);
    }

    const { ScripturaSettings } = require('../../../models');
    const currentValue = await ScripturaSettings.getValue(AUTOPILOT_MAX_RETRIES_KEY, { fallback: 3 });

    return {
      type: 'proposed_change',
      change: {
        key: AUTOPILOT_MAX_RETRIES_KEY,
        current_value: currentValue,
        proposed_value: max_retries,
      },
      message: `Proposed changing the retry count from ${currentValue} to ${max_retries} — nothing has been applied yet.`,
    };
  },
};

const getCurrentChatContextSize = {
  name: 'get_current_chat_context_size',
  description:
    'Read how many past exchanges every admin chat agent currently replays into its context on each turn.',
  input_schema: { type: 'object', properties: {} },
  async execute() {
    const { ScripturaSettings } = require('../../../models');
    const current = await ScripturaSettings.getValue(AGENT_CHAT_CONTEXT_EXCHANGES_KEY, {
      fallback: AGENT_CHAT_CONTEXT_EXCHANGES_DEFAULT,
    });
    return { type: 'read', current };
  },
};

const proposeChatContextSize = {
  name: 'propose_chat_context_size',
  description:
    'Propose a new chat context-window size — how many past user/assistant exchanges every admin chat ' +
    'agent remembers within a conversation. Higher gives better long-conversation recall at the cost of ' +
    'more tokens (and slightly slower replies) resent on every turn. Only proposes a diff for the admin ' +
    'to review; never applies it.',
  input_schema: {
    type: 'object',
    properties: {
      context_exchanges: {
        type: 'integer',
        minimum: AGENT_CHAT_CONTEXT_EXCHANGES_MIN,
        maximum: AGENT_CHAT_CONTEXT_EXCHANGES_MAX,
        description: `New context-window size, between ${AGENT_CHAT_CONTEXT_EXCHANGES_MIN} and ${AGENT_CHAT_CONTEXT_EXCHANGES_MAX}.`,
      },
    },
    required: ['context_exchanges'],
  },
  async execute({ context_exchanges } = {}) {
    if (
      !Number.isInteger(context_exchanges) ||
      context_exchanges < AGENT_CHAT_CONTEXT_EXCHANGES_MIN ||
      context_exchanges > AGENT_CHAT_CONTEXT_EXCHANGES_MAX
    ) {
      throw new Error(
        `context_exchanges must be an integer between ${AGENT_CHAT_CONTEXT_EXCHANGES_MIN} and ${AGENT_CHAT_CONTEXT_EXCHANGES_MAX}.`
      );
    }

    const { ScripturaSettings } = require('../../../models');
    const currentValue = await ScripturaSettings.getValue(AGENT_CHAT_CONTEXT_EXCHANGES_KEY, {
      fallback: AGENT_CHAT_CONTEXT_EXCHANGES_DEFAULT,
    });

    return {
      type: 'proposed_change',
      change: {
        key: AGENT_CHAT_CONTEXT_EXCHANGES_KEY,
        current_value: currentValue,
        proposed_value: context_exchanges,
      },
      message: `Proposed changing the chat context window from ${currentValue} to ${context_exchanges} exchanges — nothing has been applied yet.`,
    };
  },
};

module.exports = {
  AUTOPILOT_MAX_RETRIES_KEY,
  TOOLS: [getCurrentRetryCount, proposeRetryCount, getCurrentChatContextSize, proposeChatContextSize],
};
