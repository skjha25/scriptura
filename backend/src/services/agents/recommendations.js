'use strict';

/**
 * P0 of the Decision/Outcome/Evaluation architecture: a durable,
 * provider-independent record of "an agent suggested X," captured once per
 * `{type:'proposed_change'}` tool result.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS CALLED FROM runAgentTurn.js, NOT FROM EACH TOOL
 * ---------------------------------------------------------------------------
 * Every one of the 9 propose_* tools across 7 agents already funnels through
 * one place — runAgentTurn.js's existing `result?.type === 'proposed_change'`
 * branch (the same branch that already calls agentActivity.settingProposed).
 * Capturing here means zero changes to any tool file, and one single,
 * additive line in the one file that was already the centralized boundary.
 *
 * `start_style_profile_extraction` (Generate Agent) returns a *different*
 * shape (`{type:'style_profile_draft'}`) and is deliberately NOT captured by
 * this phase — see the P0 design report for why unifying two structurally
 * different recommendation shapes was left for a follow-up rather than
 * rushed into this pass.
 *
 * ---------------------------------------------------------------------------
 * WHY recommendation_type IS THE TOOL NAME
 * ---------------------------------------------------------------------------
 * A direct read of all 9 propose_* tools found `change.domain`/`change.action`
 * inconsistently present (missing on image/generate/autopilot's tools) and
 * `change.key` missing on propose_knowledge_update entirely. The tool name is
 * the only field confirmed present on every single one.
 *
 * ---------------------------------------------------------------------------
 * PROVIDER INDEPENDENCE
 * ---------------------------------------------------------------------------
 * Only `change` (the tool's own structured JSON return value) and `message`
 * are ever stored — never a raw provider SDK response, a tool_use/tool_call
 * id, a model name, or anything provider-shaped. `change`/`message` are
 * already provider-neutral by construction (every provider's runAgentStep
 * returns the same normalized shape — see services/ai/BaseProvider.js).
 */

const logger = require('../../utils/logger');

/** Best-effort identifier fields to lift out of `change` for convenient filtering — see the schema's own comment for why this can't be more prescriptive. */
const TARGET_REF_KEYS = ['key', 'cluster_id', 'keyword_id', 'blog_id', 'block_id', 'style', 'keyword', 'page_url'];

function extractTargetRef(change) {
  if (!change || typeof change !== 'object') return null;
  const ref = {};
  for (const k of TARGET_REF_KEYS) {
    if (change[k] !== undefined) ref[k] = change[k];
  }
  return Object.keys(ref).length > 0 ? ref : null;
}

/**
 * Records one recommendation. Best-effort by contract — same philosophy as
 * runAgentTurn.js's recordKnowledgeUsage: a storage failure here must never
 * break the chat turn that produced the recommendation. Idempotent on
 * `source_activity_id` (a unique index — see the migration) so a duplicate
 * call for the same proposal event is a silent no-op, not a crash.
 *
 * @param {object} input
 * @param {string} input.traceId
 * @param {string} input.agentName One of constants.AGENT_NAMES.
 * @param {number|null} [input.sourceActivityId] The agent_activity row id of
 *   the setting_proposed event this recommendation was captured from.
 * @param {string} input.toolName The tool that produced the recommendation — becomes `recommendation_type`.
 * @param {object} input.change The tool result's own `change` object, verbatim.
 * @param {string} [input.message] The tool result's own `message` string, if present.
 * @returns {Promise<object|null>} The created row, or null if recording failed/was skipped.
 */
async function recordRecommendation({ traceId, agentName, sourceActivityId, toolName, change, message } = {}) {
  if (!traceId || !agentName || !toolName || !change || typeof change !== 'object') {
    // Malformed input must fail safe, not throw into the caller's turn —
    // there is nothing coherent to record, so this is a no-op, logged for
    // visibility rather than silently swallowed.
    logger.warn('recordRecommendation: skipped — missing required fields', {
      hasTraceId: Boolean(traceId),
      hasAgentName: Boolean(agentName),
      hasToolName: Boolean(toolName),
      hasChange: Boolean(change),
    });
    return null;
  }

  try {
    // Lazy require, same reason as every other knowledge/recommendation
    // module in this codebase: keeps this file importable without pulling in
    // the models layer for callers that never hit this path.
    const { AgentRecommendation } = require('../../models');

    if (sourceActivityId) {
      const existing = await AgentRecommendation.findOne({ where: { source_activity_id: sourceActivityId } });
      if (existing) return existing; // idempotent: same proposal event, no duplicate row
    }

    return await AgentRecommendation.create({
      trace_id: traceId,
      agent_name: agentName,
      source_activity_id: sourceActivityId || null,
      recommendation_type: toolName,
      summary: typeof message === 'string' && message.trim() ? message.trim() : null,
      recommendation_details: change,
      target_ref: extractTargetRef(change),
      status: 'recommended',
    });
  } catch (err) {
    logger.warn('recordRecommendation failed — the chat turn is unaffected', {
      traceId,
      agentName,
      toolName,
      message: err.message,
    });
    return null;
  }
}

module.exports = { recordRecommendation, extractTargetRef, TARGET_REF_KEYS };
