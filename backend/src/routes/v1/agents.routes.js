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
  recommendationIdParams,
  listRecommendationsQuery,
  recommendationActionsParams,
  createRecommendationActionBody,
  recommendationActionIdParams,
  completeRecommendationActionBody,
  failRecommendationActionBody,
  listLearningCandidatesQuery,
  learningCandidateIdParams,
  confirmLearningCandidateBody,
  observatoryActivityQuery,
  observatoryAgentQuery,
  observatoryKnowledgeIdParams,
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
  listRecommendations,
  approveRecommendation,
  rejectRecommendation,
  bulkApproveRecommendations,
  bulkRejectRecommendations,
  listRecommendationActions,
  createRecommendationAction,
  completeRecommendationAction,
  failRecommendationAction,
  cancelRecommendationAction,
  executeRecommendationAction,
  getRecommendationActionOutcome,
  listLearningCandidates,
  confirmLearningCandidate,
  rejectLearningCandidate,
  getObservatorySummary,
  getObservatoryAgents,
  getObservatoryActivity,
  getObservatoryKnowledgeHealth,
  getObservatoryKnowledgeNodes,
  getObservatoryKnowledgeConnections,
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

/**
 * P1-A: recommendation approval/rejection (see
 * services/agents/recommendationDecisions.js). Not rate-limited: DB-only
 * state transitions, no AI call — same posture as /proposals/apply.
 *
 * GET defaults to the pending ("recommended") view; approve/reject never
 * execute anything — this is the human-decision step only, see the P1
 * design report for why action tracking is deliberately not part of P1-A.
 */
router.get('/recommendations', validate({ query: listRecommendationsQuery }), listRecommendations);
// Bulk routes declared before '/:id/...' — same reasoning as '/linkable' vs
// '/:id' elsewhere in this codebase, though these particular paths don't
// actually collide (different segment counts).
router.post('/recommendations/bulk-approve', bulkApproveRecommendations);
router.post('/recommendations/bulk-reject', bulkRejectRecommendations);
router.post('/recommendations/:id/approve', validate({ params: recommendationIdParams }), approveRecommendation);
router.post('/recommendations/:id/reject', validate({ params: recommendationIdParams }), rejectRecommendation);

/**
 * P1-B: recommendation action tracking (see
 * services/agents/recommendationActions.js). Not rate-limited: DB-only
 * bookkeeping writes, no AI call, no execution of anything — same posture as
 * the P1-A recommendation endpoints above.
 *
 * An action is never auto-created by approval — creating one is its own
 * explicit human step, guarded on the parent recommendation already being
 * 'approved'. complete/fail/cancel are self-reported outcomes; nothing here
 * executes anything, and a failed/cancelled action never changes the parent
 * recommendation's own status.
 */
router.get(
  '/recommendations/:id/actions',
  validate({ params: recommendationActionsParams }),
  listRecommendationActions
);
router.post(
  '/recommendations/:id/actions',
  validate({ params: recommendationActionsParams, body: createRecommendationActionBody }),
  createRecommendationAction
);
router.post(
  '/recommendation-actions/:id/complete',
  validate({ params: recommendationActionIdParams, body: completeRecommendationActionBody }),
  completeRecommendationAction
);
router.post(
  '/recommendation-actions/:id/fail',
  validate({ params: recommendationActionIdParams, body: failRecommendationActionBody }),
  failRecommendationAction
);
router.post(
  '/recommendation-actions/:id/cancel',
  validate({ params: recommendationActionIdParams }),
  cancelRecommendationAction
);

/**
 * POST /agents/recommendation-actions/:id/execute — P1-B4. Performs the
 * real, whitelisted Blog mutation for an automated action (see
 * services/agents/actionExecutors.js). No body: result_summary is
 * server-computed only. Not rate-limited: a DB-guarded write, no AI call —
 * same posture as complete/fail/cancel above.
 */
router.post(
  '/recommendation-actions/:id/execute',
  validate({ params: recommendationActionIdParams }),
  executeRecommendationAction
);

/**
 * GET /agents/recommendation-actions/:id/outcome — P2-D. Read-only: exposes
 * the deterministic baseline/fresh evidence + delta/classification P2-B/P2-C
 * already computed. No mutation endpoint exists for this resource — the
 * frontend can only ever read it. Not rate-limited: a DB-only read, no AI
 * call — same posture as complete/fail/cancel/execute above. Reuses the
 * existing recommendationActionIdParams validator, same :id shape.
 */
router.get(
  '/recommendation-actions/:id/outcome',
  validate({ params: recommendationActionIdParams }),
  getRecommendationActionOutcome
);

/**
 * P4-D: learning candidate review (see
 * services/agents/learningCandidateDecisions.js). Not rate-limited: DB-only
 * state transitions, no AI call — same posture as the P1-A/P1-B endpoints
 * above. Confirming writes to agent_knowledge exclusively via the existing,
 * unmodified confirmKnowledgeBatch — no new write path for that table.
 * A candidate is never auto-created here — detection is the background
 * scheduler (services/learningCandidateScheduler.js); these are the human
 * review step only.
 */
router.get('/learning-candidates', validate({ query: listLearningCandidatesQuery }), listLearningCandidates);
router.post(
  '/learning-candidates/:id/confirm',
  validate({ params: learningCandidateIdParams, body: confirmLearningCandidateBody }),
  confirmLearningCandidate
);
router.post(
  '/learning-candidates/:id/reject',
  validate({ params: learningCandidateIdParams }),
  rejectLearningCandidate
);

/**
 * P5-D: Intelligence Observatory (see services/agents/observatory.js).
 * Every route below is GET-only and purely read-only — no handler here
 * writes to any table. Not rate-limited: DB-only reads, same posture as
 * every other read endpoint on this router. This is a visualization layer
 * over the existing P0-P5 lifecycle; it introduces no new learning
 * behavior, no new scheduler, and no new write path.
 */
router.get('/observatory/summary', getObservatorySummary);
router.get('/observatory/agents', getObservatoryAgents);
router.get('/observatory/activity', validate({ query: observatoryActivityQuery }), getObservatoryActivity);
router.get('/observatory/knowledge-health', validate({ query: observatoryAgentQuery }), getObservatoryKnowledgeHealth);
router.get('/observatory/knowledge-nodes', validate({ query: observatoryAgentQuery }), getObservatoryKnowledgeNodes);
router.get(
  '/observatory/knowledge/:id/connections',
  validate({ params: observatoryKnowledgeIdParams }),
  getObservatoryKnowledgeConnections
);

module.exports = router;
