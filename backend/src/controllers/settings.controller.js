'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { AutomatedTopic, ScripturaSettings } = require('../models');
const {
  SETTINGS_SCOPE,
  AGENT_CHAT_CONTEXT_EXCHANGES_KEY,
  AGENT_CHAT_CONTEXT_EXCHANGES_DEFAULT,
  AGENT_CHAT_CONTEXT_EXCHANGES_MIN,
  AGENT_CHAT_CONTEXT_EXCHANGES_MAX,
} = require('../constants');

/**
 * Settings API for automated topics and autopilot configuration.
 */

const getTopics = asyncHandler(async (req, res) => {
  const topics = await AutomatedTopic.findAll({
    order: [['created_at', 'DESC']],
  });
  res.json({
    data: topics.map((t) => ({
      id: t.id,
      topic: t.topic,
      created_at: t.created_at,
    })),
  });
});

const addTopic = asyncHandler(async (req, res) => {
  const { topic } = req.body;
  if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
    return res.status(400).json({ error: { message: 'Topic is required and must be a non-empty string.' } });
  }

  const existing = await AutomatedTopic.findOne({ where: { topic: topic.trim() } });
  if (existing) {
    return res.status(409).json({ error: { message: 'Topic already exists.' } });
  }

  const newTopic = await AutomatedTopic.create({ topic: topic.trim() });
  res.status(201).json({
    data: {
      id: newTopic.id,
      topic: newTopic.topic,
      created_at: newTopic.created_at,
    },
  });
});

const deleteTopic = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const topic = await AutomatedTopic.findByPk(id);
  
  if (!topic) {
    return res.status(404).json({ error: { message: 'Topic not found.' } });
  }

  await topic.destroy();
  res.status(204).send();
});

const suggestTopics = asyncHandler(async (req, res) => {
  const { getTextProvider } = require('../services/ai');
  const provider = getTextProvider();
  
  const result = await provider.suggestTopics({ count: 5 });
  res.json({ data: result.topics });
});

// ---------------------------------------------------------------------------
// Autopilot settings (KV store)
// ---------------------------------------------------------------------------

/** Default values when no settings row exists yet. */
const AUTOPILOT_DEFAULTS = Object.freeze({
  'autopilot.image_count': 1,
  'autopilot.image_style': 'photo',
  'autopilot.logo_overlay': false,
  'autopilot.logo_position': 'bottom_right',
  'autopilot.max_blogs_per_day': null,
  'autopilot.max_blogs_per_week': null,
  'autopilot.optimization_profile': 'balanced',
  // How many times autopilotScheduler.js retries a failed generation before
  // marking the keyword FAILED for manual review. Was a hardcoded module
  // constant; reading it here per-tick makes it chat-editable.
  'autopilot.max_retries': 3,
  // Not actually an autopilot knob — the chat context-window size (see
  // runAgentTurn.js's getMaxPriorExchanges). Folded into this same KV group
  // and PUT /settings/autopilot mechanism because the Autopilot Scheduler
  // Agent is the one proposing it (see autopilotAgentTools.js), and this is
  // the existing right-sized "Normal Rule" apply mechanism for one scalar.
  [AGENT_CHAT_CONTEXT_EXCHANGES_KEY]: AGENT_CHAT_CONTEXT_EXCHANGES_DEFAULT,
});

/**
 * GET /api/v1/settings/autopilot
 * Returns the merged org → user override config for the current user.
 */
const getAutopilot = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const result = {};

  for (const [key, fallback] of Object.entries(AUTOPILOT_DEFAULTS)) {
    result[key] = await ScripturaSettings.getValue(key, { userId, fallback });
  }

  res.json({ data: result });
});

/**
 * PUT /api/v1/settings/autopilot
 * Upserts autopilot settings for the given scope ('org' or 'user').
 * Body: { scope?: 'org'|'user', settings: { 'autopilot.image_count': 2, ... } }
 */
const updateAutopilot = asyncHandler(async (req, res) => {
  const { scope = SETTINGS_SCOPE.USER, settings } = req.body;
  const userId = req.user.id;

  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: { message: 'settings object is required.' } });
  }

  const allowedKeys = Object.keys(AUTOPILOT_DEFAULTS);
  const saved = {};

  for (const [key, value] of Object.entries(settings)) {
    if (!allowedKeys.includes(key)) continue;

    // Only this key currently needs bounds enforcement here — everything
    // else in AUTOPILOT_DEFAULTS predates any server-side validation on this
    // endpoint, which is a pre-existing gap out of scope for this change.
    if (key === AGENT_CHAT_CONTEXT_EXCHANGES_KEY) {
      const n = Number(value);
      if (!Number.isInteger(n) || n < AGENT_CHAT_CONTEXT_EXCHANGES_MIN || n > AGENT_CHAT_CONTEXT_EXCHANGES_MAX) {
        return res.status(400).json({
          error: {
            message: `${AGENT_CHAT_CONTEXT_EXCHANGES_KEY} must be an integer between ${AGENT_CHAT_CONTEXT_EXCHANGES_MIN} and ${AGENT_CHAT_CONTEXT_EXCHANGES_MAX}.`,
          },
        });
      }
    }

    await ScripturaSettings.setValue(key, value, {
      scope,
      userId: scope === SETTINGS_SCOPE.USER ? userId : null,
    });
    saved[key] = value;
  }

  res.json({ data: saved });
});

module.exports = {
  getTopics,
  addTopic,
  deleteTopic,
  suggestTopics,
  getAutopilot,
  updateAutopilot,
};
