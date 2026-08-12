'use strict';

/**
 * /agents controllers.
 *
 * `applySetting` is the ONLY handler allowed to call ScripturaSettings.setValue
 * for an agent-controlled key — see validators/agents.validators.js and
 * services/agents/tools/*.js for the rest of that safety chain. Every other
 * handler here either reads state or drives the chat loop.
 */

const crypto = require('crypto');

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { AGENT_NAMES, AGENT_EVENT_TYPES, SETTINGS_SCOPE, IMAGE_STYLES } = require('../constants');
const { STYLE_DIRECTIVES, BASE_DIRECTIVES } = require('../services/imageGeneration');
const { EDITORIAL_GOLDEN_RULES } = require('../services/ai/prompts');
const agentActivityLogger = require('../services/agentActivityLogger');
const { runAgentTurn, getChatHistory } = require('../services/agents/runAgentTurn');
const { confirmStyleProfile, extractStyleProfile: extractStyleProfileService } = require('../services/agents/styleProfile');
const knowledgeBase = require('../services/agents/knowledge/knowledgeBase');
const knowledgeStore = require('../services/agents/knowledge/knowledgeStore');

/** POST /agents/:agentName/chat */
const chat = asyncHandler(async (req, res) => {
  const { agentName } = req.params;
  const { message, trace_id, context } = req.body;

  const result = await runAgentTurn({
    agentName,
    userId: req.user.id,
    message,
    traceId: trace_id,
    context,
  });

  res.json({ data: result });
});

/**
 * GET /agents/:agentName/history
 *
 * Lets the widget reload the admin's last conversation with this agent on
 * mount/login instead of always starting blank. Read-only, scoped to the
 * calling admin — never returns another admin's trace.
 */
const getHistory = asyncHandler(async (req, res) => {
  const { agentName } = req.params;
  const result = await getChatHistory({ userId: req.user.id, agentName });
  res.json({ data: result });
});

/**
 * POST /agents/:agentName/history/clear
 *
 * Writes a `chat_cleared` marker so getHistory stops reconstructing before
 * this point. Never deletes agent_activity rows — the audit trail behind it
 * is retained indefinitely regardless of what an admin clears from their own
 * widget view.
 */
const clearHistory = asyncHandler(async (req, res) => {
  const { agentName } = req.params;
  const traceId = crypto.randomUUID();
  await agentActivityLogger.chatCleared({ traceId, agentName, userId: req.user.id });
  res.json({ data: { cleared: true } });
});

/**
 * GET /agents/golden-rules — read-only reference for the admin UI. These are
 * the hardcoded directives no agent can ever propose changing (see
 * BASE_DIRECTIVES's doc comment in imageGeneration.js and
 * EDITORIAL_GOLDEN_RULES's in ai/prompts.js): shown here so an admin can SEE
 * them, never to make them editable.
 */
const getGoldenRules = asyncHandler(async (req, res) => {
  res.json({ data: { image: BASE_DIRECTIVES, content: EDITORIAL_GOLDEN_RULES } });
});

/** GET /agents/settings/:key — read-only, no model call, for "what's set now" UI. */
const getSetting = asyncHandler(async (req, res) => {
  const { key } = req.params;
  const { ScripturaSettings } = require('../models');

  if (key === 'agents.image.style_overrides') {
    const overrides = (await ScripturaSettings.getValue(key, { fallback: {} })) || {};
    const current = Object.fromEntries(
      IMAGE_STYLES.map((style) => [style, overrides[style]?.directive_text || STYLE_DIRECTIVES[style]])
    );
    return res.json({ data: current });
  }

  const value = await ScripturaSettings.getValue(key, { fallback: null });
  res.json({ data: value });
});

/**
 * POST /agents/settings/apply
 *
 * Re-validates (via the Zod discriminated union upstream) independently of
 * whatever the tool proposed, then is the sole writer of the setting.
 */
const applySetting = asyncHandler(async (req, res) => {
  const { ScripturaSettings } = require('../models');
  const { key } = req.body;
  // agent_activity.trace_id is NOT NULL — an Apply click isn't always part of
  // a live chat turn (the widget may re-open later, or a future settings page
  // may apply directly), so a fresh id groups it as its own one-row trace
  // rather than leaving a gap in the audit trail.
  const trace_id = req.body.trace_id || crypto.randomUUID();

  if (key === 'agents.image.style_overrides') {
    const { style, directive_text } = req.body;
    const overrides = (await ScripturaSettings.getValue(key, { fallback: {} })) || {};
    const previousValue = overrides[style]?.directive_text || STYLE_DIRECTIVES[style];

    const nextOverrides = {
      ...overrides,
      [style]: { directive_text, updated_at: new Date().toISOString() },
    };
    await ScripturaSettings.setValue(key, nextOverrides, { scope: SETTINGS_SCOPE.ORG });

    await agentActivityLogger.settingApplied({
      traceId: trace_id,
      agentName: AGENT_NAMES.BLOG_IMAGE,
      settingKey: key,
      previousValue,
      newValue: directive_text,
      userId: req.user.id,
      metadata: { style },
    });

    return res.json({ data: { key, style, value: directive_text } });
  }

  if (key === 'agents.generate.content_defaults') {
    // eslint-disable-next-line no-unused-vars -- destructured only to drop from `fields`
    const { key: _key, trace_id: _traceId, ...fields } = req.body;
    const current = (await ScripturaSettings.getValue(key, { fallback: {} })) || {};
    const next = { ...current, ...fields };
    await ScripturaSettings.setValue(key, next, { scope: SETTINGS_SCOPE.ORG });

    await agentActivityLogger.settingApplied({
      traceId: trace_id,
      agentName: AGENT_NAMES.GENERATE,
      settingKey: key,
      previousValue: current,
      newValue: next,
      userId: req.user.id,
    });

    return res.json({ data: next });
  }

  // Unreachable given the discriminated-union validator, kept as a defensive
  // guard in case a settings key is added to the enum without a branch here.
  throw ApiError.badRequest(`Unsupported settings key "${key}".`);
});

/** POST /agents/settings/revert */
const revertSetting = asyncHandler(async (req, res) => {
  const { ScripturaSettings, AgentActivity } = require('../models');
  const { key, style } = req.body;
  // Same reasoning as applySetting above — a revert is its own standalone action.
  const trace_id = crypto.randomUUID();

  if (key === 'agents.image.style_overrides') {
    if (!style) {
      throw ApiError.badRequest('style is required to revert an image style override.', {
        code: 'STYLE_REQUIRED',
      });
    }

    const rows = await AgentActivity.findAll({
      where: { setting_key: key, event_type: AGENT_EVENT_TYPES.SETTING_APPLIED },
      order: [['created_at', 'DESC']],
      limit: 20,
    });
    const match = rows.find((row) => row.payload?.style === style);

    const overrides = (await ScripturaSettings.getValue(key, { fallback: {} })) || {};
    const revertedFrom = overrides[style]?.directive_text || STYLE_DIRECTIVES[style];
    const revertedTo = match ? match.payload.diff.current_value : STYLE_DIRECTIVES[style];

    const nextOverrides = {
      ...overrides,
      [style]: { directive_text: revertedTo, updated_at: new Date().toISOString() },
    };
    await ScripturaSettings.setValue(key, nextOverrides, { scope: SETTINGS_SCOPE.ORG });

    await agentActivityLogger.settingReverted({
      traceId: trace_id,
      agentName: AGENT_NAMES.BLOG_IMAGE,
      settingKey: key,
      revertedFrom,
      revertedTo,
      userId: req.user.id,
      metadata: { style },
    });

    return res.json({ data: { key, style, value: revertedTo } });
  }

  if (key === 'agents.generate.content_defaults') {
    const rows = await AgentActivity.findAll({
      where: { setting_key: key, event_type: AGENT_EVENT_TYPES.SETTING_APPLIED },
      order: [['created_at', 'DESC']],
      limit: 1,
    });
    const match = rows[0];

    const current = (await ScripturaSettings.getValue(key, { fallback: {} })) || {};
    const revertedTo = match ? match.payload.diff.current_value : {};
    await ScripturaSettings.setValue(key, revertedTo, { scope: SETTINGS_SCOPE.ORG });

    await agentActivityLogger.settingReverted({
      traceId: trace_id,
      agentName: AGENT_NAMES.GENERATE,
      settingKey: key,
      revertedFrom: current,
      revertedTo,
      userId: req.user.id,
    });

    return res.json({ data: revertedTo });
  }

  throw ApiError.badRequest(`Unsupported settings key "${key}".`);
});

/**
 * POST /agents/generate/style-profile/extract
 *
 * Dedicated "teach it something new" action for the Platform Rules page —
 * runs the same analysis as the Generate Agent's start_style_profile_extraction
 * tool, but as a direct call (no chat turn, no tool-use loop) since this is a
 * single well-defined action, not a conversation. Always returns a DRAFT;
 * confirmStyleProfileHandler below is still the only path that persists it.
 */
const extractStyleProfile = asyncHandler(async (req, res) => {
  const { blog_ids, raw_samples } = req.body;
  const result = await extractStyleProfileService({ blogIds: blog_ids || [], rawSamples: raw_samples || [] });
  res.json({ data: result });
});

/**
 * POST /agents/generate/style-profile/confirm
 *
 * The only path that can turn a draft style profile into the confirmed value
 * services/generation.js reads. The admin submits whatever profile they
 * reviewed in chat (this endpoint re-validates the shape independently, same
 * pattern as applySetting).
 */
const confirmStyleProfileHandler = asyncHandler(async (req, res) => {
  const traceId = crypto.randomUUID();
  const value = await confirmStyleProfile(req.body);

  await agentActivityLogger.settingApplied({
    traceId,
    agentName: AGENT_NAMES.GENERATE,
    settingKey: 'agents.generate.style_profile',
    previousValue: null,
    newValue: value,
    userId: req.user.id,
  });

  res.json({ data: value });
});

// ---------------------------------------------------------------------------
// Knowledge & Learning Layer (see /home/shivam/.claude/plans/zazzy-doodling-wadler.md)
// ---------------------------------------------------------------------------

/**
 * GET /agents/:agentName/knowledge-base
 *
 * Read-only listing of this agent's current retrievable knowledge (global +
 * its own scope, confirmed/supported only — see knowledgeStore.retrieveKnowledge).
 * A higher limit than the retrieval-for-a-prompt call uses, since this is for
 * an admin to review the whole thing, not to bound a token budget.
 */
const getKnowledgeBase = asyncHandler(async (req, res) => {
  const rows = await knowledgeStore.retrieveKnowledge(req.params.agentName, { limit: 50 });
  res.json({ data: rows });
});

/**
 * POST /agents/:agentName/knowledge-base/extract
 *
 * Ingest -> extract -> validate one "teach this agent" submission. Always
 * returns a DRAFT batch; confirmKnowledgeBaseHandler below is the only path
 * that persists anything from it.
 */
const extractKnowledgeBaseHandler = asyncHandler(async (req, res) => {
  const { text_samples, links, image_paths, youtube_links } = req.body;
  const result = await knowledgeBase.proposeKnowledgeBatch({
    agentName: req.params.agentName,
    textSamples: text_samples || [],
    links: links || [],
    imagePaths: image_paths || [],
    youtubeLinks: youtube_links || [],
    videoBuffer: req.videoFile?.buffer || null,
    videoMimeType: req.videoFile?.mimetype || null,
    userId: req.user.id,
  });
  res.json({ data: result });
});

/**
 * POST /agents/:agentName/knowledge-base/confirm
 *
 * The only path that can turn a reviewed draft batch into real
 * `agent_knowledge` writes. Logs one `setting_applied` row per batch (not
 * per item) — that single row is what services/agents/tools/sharedKnowledgeTools.js's
 * (Phase 4) `get_recent_learning` tool reads to answer "what did you learn today."
 */
const confirmKnowledgeBaseHandler = asyncHandler(async (req, res) => {
  const traceId = crypto.randomUUID();
  const { agentName } = req.params;
  const result = await knowledgeBase.confirmKnowledgeBatch(
    { agentName, items: req.body.items, scope: req.body.scope },
    { userId: req.user.id }
  );

  await agentActivityLogger.settingApplied({
    traceId,
    agentName,
    settingKey: `agents.${agentName}.knowledge_base`,
    previousValue: null,
    newValue: {
      created: result.created.map((r) => r.id),
      updated: result.updated.map((r) => r.id),
      skipped: result.skipped,
    },
    userId: req.user.id,
  });

  res.json({
    data: {
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
    },
  });
});

/**
 * POST /agents/:agentName/dismiss
 *
 * Logs that an admin explicitly dismissed a proposed change without
 * applying it — previously nothing was written at all (AgentChatWidget.js's
 * Dismiss button was purely local UI state), so "rejected" and "never
 * reviewed" were indistinguishable in the audit log. See
 * agentActivityLogger.js's settingDismissed for why this matters (a stated
 * prerequisite for Chief Agent delegation-outcome learning, not built here).
 */
const dismissChange = asyncHandler(async (req, res) => {
  const { agentName } = req.params;
  const { trace_id, setting_key, proposed_value } = req.body;

  await agentActivityLogger.settingDismissed({
    traceId: trace_id,
    agentName,
    settingKey: setting_key || null,
    proposedValue: proposed_value ?? null,
    userId: req.user.id,
  });

  res.json({ data: { dismissed: true } });
});

/**
 * GET /agents/knowledge-usage?trace_id=...
 *
 * "What knowledge influenced this turn" — answers the audit's Part 2
 * point-5/6 gap directly from stored data (agent_knowledge_usage, written by
 * runAgentTurn.js's recordKnowledgeUsage) instead of only being provable by
 * re-running a one-off script.
 */
const getKnowledgeUsage = asyncHandler(async (req, res) => {
  const { AgentKnowledgeUsage, AgentKnowledge } = require('../models');
  const { trace_id } = req.query;

  const rows = await AgentKnowledgeUsage.findAll({
    where: { trace_id },
    order: [['relevance_score', 'DESC']],
    include: [{ model: AgentKnowledge, as: 'knowledge', attributes: ['id', 'claim', 'category', 'status'] }],
  });

  res.json({
    data: rows.map((row) => ({
      knowledge_id: row.knowledge_id,
      claim: row.knowledge?.claim || null,
      category: row.knowledge?.category || null,
      status: row.knowledge?.status || null,
      relevance_score: row.relevance_score,
      retrieval_method: row.retrieval_method,
    })),
  });
});

/** GET /agents/activity */
const listActivity = asyncHandler(async (req, res) => {
  const { AgentActivity } = require('../models');
  const { trace_id, agent_name, limit = 100 } = req.query;

  const where = {};
  if (trace_id) where.trace_id = trace_id;
  if (agent_name) where.agent_name = agent_name;

  const rows = await AgentActivity.findAll({
    where,
    order: [['created_at', 'DESC']],
    limit,
  });

  res.json({ data: rows });
});

module.exports = {
  chat,
  getHistory,
  clearHistory,
  getGoldenRules,
  getSetting,
  applySetting,
  revertSetting,
  extractStyleProfile,
  confirmStyleProfile: confirmStyleProfileHandler,
  getKnowledgeBase,
  extractKnowledgeBase: extractKnowledgeBaseHandler,
  confirmKnowledgeBase: confirmKnowledgeBaseHandler,
  dismissChange,
  getKnowledgeUsage,
  listActivity,
};
