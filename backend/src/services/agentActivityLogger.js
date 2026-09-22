'use strict';

/**
 * Structured activity logger — writes agentic-AI chat events to the
 * `agent_activity` table for permanent monitoring and audit.
 *
 * Every method is fire-and-forget by design: a logging failure must never
 * break a chat turn or the generation pipeline it may influence. Errors are
 * caught internally and emitted to the console logger, so observability
 * degrades gracefully rather than causing a user-visible error. Mirrors the
 * structure of ./activityLogger.js exactly.
 *
 * Usage:
 *   const agentActivity = require('./agentActivityLogger');
 *   await agentActivity.toolCall({ traceId, agentName, toolName, payload });
 */

const crypto = require('crypto');

const logger = require('../utils/logger');
const { AGENT_EVENT_TYPES, LOG_STATUS } = require('../constants');

/** @returns {import('../models').AgentActivity} */
function getModel() {
  return require('../models').AgentActivity;
}

/**
 * Internal helper — creates an activity row, swallowing errors.
 * @param {object} data
 * @returns {Promise<import('../models').AgentActivity|null>} The created row,
 *   or null on failure. Every existing call site ignores this return value
 *   (confirmed — none of them capture it), so returning it is purely
 *   additive: callers that need the row's id for provenance/idempotency
 *   (see services/agents/recommendations.js) now can, without any existing
 *   caller's behavior changing.
 */
async function safeCreate(data) {
  try {
    const AgentActivity = getModel();
    // trace_id is NOT NULL — settingApplied/settingReverted can legitimately
    // fire outside a live chat turn (e.g. a standalone Apply click), so any
    // caller that didn't have one gets a fresh id here rather than the insert
    // failing (and, per the fire-and-forget contract above, failing silently).
    return await AgentActivity.create({ ...data, trace_id: data.trace_id || crypto.randomUUID() });
  } catch (err) {
    logger.error('agentActivityLogger: failed to write activity entry', {
      event_type: data.event_type,
      error: err.message,
    });
  }
}

/**
 * Log: the admin's chat message that started (or continued) a turn.
 */
async function userMessage({ traceId, agentName, userId, message, metadata } = {}) {
  await safeCreate({
    trace_id: traceId,
    agent_name: agentName,
    event_type: AGENT_EVENT_TYPES.USER_MESSAGE,
    status: LOG_STATUS.INFO,
    user_id: userId || null,
    payload: { message, ...metadata },
  });
}

/**
 * Log: the Chief Agent delegating an instruction to a sub-agent.
 */
async function delegation({ traceId, fromAgent, toAgent, instruction, userId, metadata } = {}) {
  await safeCreate({
    trace_id: traceId,
    agent_name: fromAgent,
    event_type: AGENT_EVENT_TYPES.DELEGATION,
    status: LOG_STATUS.INFO,
    from_agent: fromAgent,
    to_agent: toAgent,
    user_id: userId || null,
    payload: { instruction, ...metadata },
  });
}

/**
 * Log: an agent invoking one of its tools.
 *
 * @returns {Promise<import('../models').AgentActivity|null>} The created row
 *   — see safeCreate's own doc comment. Confirmed (grep, one real call site:
 *   runAgentTurn.js) that the existing caller ignores this return value, so
 *   returning it is purely additive — needed by the new `type:'recommendation'`
 *   branch there as the provenance/idempotency anchor (services/agents/
 *   recommendations.js), since that path deliberately never calls
 *   settingProposed (see runAgentTurn.js's own comment on that branch).
 */
async function toolCall({ traceId, agentName, toolName, input, result, userId, status, metadata } = {}) {
  return safeCreate({
    trace_id: traceId,
    agent_name: agentName,
    event_type: AGENT_EVENT_TYPES.TOOL_CALL,
    status: status || LOG_STATUS.SUCCESS,
    tool_name: toolName,
    user_id: userId || null,
    payload: { input, result, ...metadata },
  });
}

/**
 * Log: a tool proposed a settings change (NOT yet applied — nothing was written).
 */
/**
 * @returns {Promise<import('../models').AgentActivity|null>} The created row
 *   — see safeCreate's own doc comment for why this is now returned (needed
 *   by services/agents/recommendations.js as the provenance/idempotency key).
 */
async function settingProposed({ traceId, agentName, toolName, settingKey, currentValue, proposedValue, userId, metadata } = {}) {
  return safeCreate({
    trace_id: traceId,
    agent_name: agentName,
    event_type: AGENT_EVENT_TYPES.SETTING_PROPOSED,
    status: LOG_STATUS.INFO,
    tool_name: toolName || null,
    setting_key: settingKey,
    user_id: userId || null,
    payload: { diff: { current_value: currentValue, proposed_value: proposedValue }, ...metadata },
  });
}

/**
 * Log: a human explicitly applied a previously proposed change.
 */
async function settingApplied({ traceId, agentName, settingKey, previousValue, newValue, userId, metadata } = {}) {
  await safeCreate({
    trace_id: traceId || null,
    agent_name: agentName,
    event_type: AGENT_EVENT_TYPES.SETTING_APPLIED,
    status: LOG_STATUS.SUCCESS,
    setting_key: settingKey,
    user_id: userId || null,
    payload: { diff: { current_value: previousValue, proposed_value: newValue }, ...metadata },
  });
}

/**
 * Log: a human explicitly dismissed a proposed change without applying it.
 *
 * Knowledge Layer v2 addition — previously AgentChatWidget.js's Dismiss
 * button only updated local UI state, so "explicitly rejected" and "never
 * reviewed" were indistinguishable in the audit log. This is the stated
 * prerequisite for eventually letting Chief Agent learn from delegation
 * outcomes (a rejected proposal is a real negative signal); it does not
 * itself implement any outcome learning.
 */
async function settingDismissed({ traceId, agentName, settingKey, proposedValue, userId, metadata } = {}) {
  await safeCreate({
    trace_id: traceId || null,
    agent_name: agentName,
    event_type: AGENT_EVENT_TYPES.SETTING_DISMISSED,
    status: LOG_STATUS.WARNING,
    setting_key: settingKey || null,
    user_id: userId || null,
    payload: { diff: { proposed_value: proposedValue }, ...metadata },
  });
}

/**
 * Log: a human reverted a setting back to its previous value.
 */
async function settingReverted({ traceId, agentName, settingKey, revertedFrom, revertedTo, userId, metadata } = {}) {
  await safeCreate({
    trace_id: traceId || null,
    agent_name: agentName,
    event_type: AGENT_EVENT_TYPES.SETTING_REVERTED,
    status: LOG_STATUS.WARNING,
    setting_key: settingKey,
    user_id: userId || null,
    payload: { diff: { current_value: revertedFrom, proposed_value: revertedTo }, ...metadata },
  });
}

/**
 * Log: an agent turn or tool call errored out.
 */
async function error({ traceId, agentName, toolName, err, userId, metadata } = {}) {
  await safeCreate({
    trace_id: traceId || null,
    agent_name: agentName,
    event_type: AGENT_EVENT_TYPES.ERROR,
    status: LOG_STATUS.FAILURE,
    tool_name: toolName || null,
    user_id: userId || null,
    payload: { error_message: err?.message ? err.message.slice(0, 2000) : String(err), ...metadata },
  });
}

/**
 * Log: the agent's final natural-language reply for a turn.
 */
async function finalReply({ traceId, agentName, reply, toolCallCount, userId, metadata } = {}) {
  await safeCreate({
    trace_id: traceId,
    agent_name: agentName,
    event_type: AGENT_EVENT_TYPES.FINAL_REPLY,
    status: LOG_STATUS.SUCCESS,
    user_id: userId || null,
    payload: { reply, tool_call_count: toolCallCount, ...metadata },
  });
}

/**
 * Log: the admin clicked "Clear chat" in the widget. Not a deletion — this
 * table is never pruned (see agentActivity.js) — just a cutoff marker so
 * runAgentTurn.js's getChatHistory() knows to stop reconstructing the
 * widget's reload-on-open thread before this point.
 */
async function chatCleared({ traceId, agentName, userId, metadata } = {}) {
  await safeCreate({
    trace_id: traceId,
    agent_name: agentName,
    event_type: AGENT_EVENT_TYPES.CHAT_CLEARED,
    status: LOG_STATUS.INFO,
    user_id: userId || null,
    payload: { ...metadata },
  });
}

module.exports = {
  userMessage,
  delegation,
  toolCall,
  settingProposed,
  settingApplied,
  settingReverted,
  settingDismissed,
  error,
  finalReply,
  chatCleared,
};
