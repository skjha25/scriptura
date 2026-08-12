'use strict';

/**
 * /agents routes — the agentic-AI chat layer (Blog Image Agent, Generate
 * Agent, Chief Agent).
 *
 * The entire surface is admin-only: every endpoint here either changes
 * platform-wide generation behaviour or exposes the audit trail of who
 * changed what — unlike e.g. /media/generate-image, which any editor may
 * call because it only affects one blog.
 *
 * Middleware order matches house style: requireAuth -> requireAdmin ->
 * [agentChatLimiter on paid calls] -> validate -> handler.
 */

const express = require('express');

const { requireAuth, requireAdmin } = require('../../middleware/auth');
const { agentChatLimiter } = require('../../middleware/rateLimit');
const { validate } = require('../../middleware/validate');
const { videoUpload, requireVideoFile } = require('../../middleware/videoUpload');
const {
  agentChatBody,
  agentNameParams,
  nonGenerateAgentNameParams,
  applySettingBody,
  revertSettingBody,
  settingKeyParams,
  confirmStyleProfileBody,
  extractStyleProfileBody,
  listActivityQuery,
  extractKnowledgeBaseBody,
  confirmKnowledgeBatchBody,
  dismissChangeBody,
  knowledgeUsageQuery,
} = require('../../validators/agents.validators');
const {
  chat,
  getHistory,
  clearHistory,
  getGoldenRules,
  getSetting,
  applySetting,
  revertSetting,
  confirmStyleProfile,
  extractStyleProfile,
  getKnowledgeBase,
  extractKnowledgeBase,
  confirmKnowledgeBase,
  listActivity,
  dismissChange,
  getKnowledgeUsage,
} = require('../../controllers/agents.controller');
const { applyProposalBody } = require('../../validators/proposals.validators');
const { applyProposal } = require('../../controllers/proposals.controller');

const router = express.Router();

router.use(requireAuth, requireAdmin);

/** POST /agents/:agentName/chat — one chat turn. Rate-limited: spends a real Claude call. */
router.post(
  '/:agentName/chat',
  agentChatLimiter,
  validate({ params: agentNameParams, body: agentChatBody }),
  chat
);

/** GET /agents/golden-rules — the hardcoded directives no agent can ever propose changing. */
router.get('/golden-rules', getGoldenRules);

/**
 * POST /agents/generate/style-profile/extract — direct analysis call, no chat
 * turn. A single well-defined action ("analyse these samples"), so it skips
 * the Claude tool-use loop entirely rather than routing through the Generate
 * Agent — the actual model call still happens inside styleProfile.js.
 */
router.post(
  '/generate/style-profile/extract',
  validate({ body: extractStyleProfileBody }),
  extractStyleProfile
);

/** GET /agents/:agentName/history — reload this admin's last conversation with this agent. */
router.get('/:agentName/history', validate({ params: agentNameParams }), getHistory);

/** POST /agents/:agentName/history/clear — marks the widget's visible thread as cleared, no deletion. */
router.post('/:agentName/history/clear', validate({ params: agentNameParams }), clearHistory);

/**
 * POST /agents/:agentName/dismiss — logs that the admin explicitly rejected a
 * proposed change (setting or knowledge update) without applying it. Not a
 * writer of any real state — agent_activity only, same audit-trail role as
 * settingApplied/settingReverted. See agentActivityLogger.settingDismissed.
 */
router.post(
  '/:agentName/dismiss',
  validate({ params: agentNameParams, body: dismissChangeBody }),
  dismissChange
);

/**
 * Knowledge & Learning Layer (see /home/shivam/.claude/plans/zazzy-doodling-wadler.md).
 * Not valid for generate_agent — it keeps its own separate style-profile
 * flow above (nonGenerateAgentNameParams enforces this).
 */

/** GET /agents/:agentName/knowledge-base — current retrievable knowledge, no model call. */
router.get(
  '/:agentName/knowledge-base',
  validate({ params: nonGenerateAgentNameParams }),
  getKnowledgeBase
);

/**
 * POST /agents/:agentName/knowledge-base/extract — ingest+extract+validate one
 * "teach this agent" submission. Rate-limited like /chat: spends a real model
 * call and, when a video clip is attached, a Whisper transcription call too.
 */
router.post(
  '/:agentName/knowledge-base/extract',
  agentChatLimiter,
  videoUpload.single('video'),
  requireVideoFile({ required: false }),
  // validate runs AFTER multer — text fields don't exist on req.body until
  // the multipart body is parsed (same house rule as /media/upload).
  validate({ params: nonGenerateAgentNameParams, body: extractKnowledgeBaseBody }),
  extractKnowledgeBase
);

/** POST /agents/:agentName/knowledge-base/confirm — the only writer of agent_knowledge. */
router.post(
  '/:agentName/knowledge-base/confirm',
  validate({ params: nonGenerateAgentNameParams, body: confirmKnowledgeBatchBody }),
  confirmKnowledgeBase
);

/** GET /agents/settings/:key — current value, no model call. */
router.get('/settings/:key', validate({ params: settingKeyParams }), getSetting);

/** POST /agents/settings/apply — the only writer of an agent-controlled setting. */
router.post('/settings/apply', validate({ body: applySettingBody }), applySetting);

/** POST /agents/settings/revert — reapplies the previous value. */
router.post('/settings/revert', validate({ body: revertSettingBody }), revertSetting);

/** POST /agents/generate/style-profile/confirm — the confirm gate for a draft style profile. */
router.post(
  '/generate/style-profile/confirm',
  validate({ body: confirmStyleProfileBody }),
  confirmStyleProfile
);

/**
 * POST /agents/proposals/apply — the entity-mutation counterpart to
 * /settings/apply. Not rate-limited: a DB write, not an AI call.
 */
router.post('/proposals/apply', validate({ body: applyProposalBody }), applyProposal);

/** GET /agents/activity — audit feed for the Trace/Activity page and the chat widget. */
router.get('/activity', validate({ query: listActivityQuery }), listActivity);

/** GET /agents/knowledge-usage — which knowledge rows were retrieved for a given turn. */
router.get('/knowledge-usage', validate({ query: knowledgeUsageQuery }), getKnowledgeUsage);

module.exports = router;
