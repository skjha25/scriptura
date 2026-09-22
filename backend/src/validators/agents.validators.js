'use strict';

/**
 * Zod schemas for the /agents surface.
 *
 * WHY applySettingBody IS A DISCRIMINATED UNION ON `key`
 * ---------------------------------------------------------------------------
 * This is the ONLY code path allowed to write ScripturaSettings for an
 * agent-controlled key (see services/agents/tools/*.js — no tool ever calls
 * ScripturaSettings.setValue itself). That makes this schema the actual
 * enforcement point for "nothing an agent proposes auto-applies without being
 * independently re-validated" — it must re-check every constraint a tool's
 * proposal claimed to satisfy (style must be a real IMAGE_STYLES value,
 * directive length, etc), not trust the client's request body.
 */

const { z } = require('zod');

const { IMAGE_STYLES, POINTS_OF_VIEW, READABILITY_LEVELS, AGENT_NAMES } = require('../constants');
const { MIN_DIRECTIVE_LENGTH, MAX_DIRECTIVE_LENGTH } = require('../services/agents/tools/imageAgentTools');

const traceIdField = z.string().uuid().optional();

/**
 * Optional page-supplied context, injected into the first message of the
 * turn by runAgentTurn.js. Only the Blog Ops Agent's Editor-page widget
 * sends this today (current blocks, so the model has something to reason
 * about before proposing a block edit — see blogOpsAgentTools.js's
 * get_current_blocks tool doc comment for why this is still only a
 * snapshot, not a live view). Kept to a specific shape rather than a fully
 * open object so a stray client can't smuggle an unbounded payload into
 * every chat call.
 */
const agentChatContext = z
  .object({
    blog_id: z.coerce.number().int().positive().optional(),
    blocks: z.array(z.record(z.any())).max(200).optional(),
    // Current blog_title, so the Blog Ops Agent can propose a title edit
    // without guessing at what the title currently is.
    blog_title: z.string().trim().max(255).optional(),
  })
  .strict()
  .optional();

/** POST /agents/:agentName/chat */
const agentChatBody = z
  .object({
    message: z.string().trim().min(1, 'A message is required.').max(4000, 'At most 4000 characters.'),
    trace_id: traceIdField,
    context: agentChatContext,
  })
  .strict();

/** params for /agents/:agentName/... */
const agentNameParams = z
  .object({
    agentName: z.enum(Object.values(AGENT_NAMES), {
      errorMap: () => ({ message: `agentName must be one of ${Object.values(AGENT_NAMES).join(', ')}.` }),
    }),
  })
  .strict();

const imageStyleOverrideApply = z
  .object({
    key: z.literal('agents.image.style_overrides'),
    style: z.enum(IMAGE_STYLES),
    directive_text: z.string().trim().min(MIN_DIRECTIVE_LENGTH).max(MAX_DIRECTIVE_LENGTH),
    trace_id: traceIdField,
  })
  .strict();

const contentDefaultsApply = z
  .object({
    key: z.literal('agents.generate.content_defaults'),
    tone_of_voice: z.string().trim().max(255).optional(),
    point_of_view: z.enum(POINTS_OF_VIEW).optional(),
    readability_level: z.enum(READABILITY_LEVELS).optional(),
    extra_notes: z.string().trim().max(2000).optional(),
    trace_id: traceIdField,
  })
  .strict();

// `z.discriminatedUnion` requires each member to be a plain ZodObject (it reads
// `.shape` directly), so the "at least one field" cross-field check for
// contentDefaultsApply can't live in a `.refine()` on the member itself —
// applied instead as a `.superRefine()` on the union as a whole.
const applySettingBody = z
  .discriminatedUnion('key', [imageStyleOverrideApply, contentDefaultsApply], {
    errorMap: () => ({ message: 'key must be one of the known agent-controlled settings keys.' }),
  })
  .superRefine((val, ctx) => {
    if (val.key !== 'agents.generate.content_defaults') return;
    if (!val.tone_of_voice && !val.point_of_view && !val.readability_level && !val.extra_notes) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one content default field is required.' });
    }
  });

/** POST /agents/settings/revert */
const revertSettingBody = z
  .object({
    key: z.enum(['agents.image.style_overrides', 'agents.generate.content_defaults']),
    style: z.enum(IMAGE_STYLES).optional(), // required in practice for the image key; enforced in the controller
  })
  .strict();

/** GET /agents/settings/:key */
const settingKeyParams = z
  .object({
    key: z.enum(['agents.image.style_overrides', 'agents.generate.content_defaults', 'agents.generate.style_profile']),
  })
  .strict();

/**
 * POST /agents/generate/style-profile/confirm
 *
 * This is the ONE explicit human action that can turn a draft style profile
 * (returned in-chat by the start_style_profile_extraction tool, never
 * persisted by it) into the confirmed value services/generation.js reads —
 * mirrors the existing `brand_voice_confirmed` gate pattern exactly.
 */
/**
 * POST /agents/generate/style-profile/extract
 *
 * Mirrors the caps styleProfile.js's extractStyleProfile enforces itself
 * (MAX_SAMPLES total, non-empty), plus a per-sample length bound so a stray
 * client can't smuggle an unbounded paste into one request body.
 */
const extractStyleProfileBody = z
  .object({
    blog_ids: z.array(z.coerce.number().int().positive()).max(20).optional(),
    raw_samples: z.array(z.string().trim().min(1).max(20000)).max(20).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if ((val.blog_ids?.length || 0) + (val.raw_samples?.length || 0) === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide at least one blog_id or raw_sample to learn a style from.',
      });
    }
  });

const confirmStyleProfileBody = z
  .object({
    tone: z.string().trim().max(500).nullable().optional(),
    pov: z.enum(POINTS_OF_VIEW).nullable().optional(),
    // 100 was too tight for what the model actually produces for a "concrete,
    // checkable style rule" (see brandVoicePrompt's trait guidance in
    // ai/prompts.js) — real traits routinely run 100-250 chars, so the cap
    // was failing confirmStyleProfile on every real save. 300 keeps a bound
    // without rejecting normal output.
    traits: z.array(z.string().trim().max(300)).max(20).optional(),
    summary: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

/** GET /agents/activity */
const listActivityQuery = z
  .object({
    trace_id: z.string().uuid().optional(),
    agent_name: z.enum(Object.values(AGENT_NAMES)).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Knowledge & Learning Layer
// ---------------------------------------------------------------------------

const {
  MAX_TEXT_SAMPLES,
  MAX_LINKS,
  MAX_IMAGES,
  MAX_YOUTUBE_LINKS,
} = require('../services/agents/knowledge/knowledgeIngestion');

/** agentName params excluding generate_agent — the generic knowledge base is not valid for it. */
const nonGenerateAgentNameParams = z
  .object({
    agentName: z.enum(
      Object.values(AGENT_NAMES).filter((n) => n !== AGENT_NAMES.GENERATE)
    ),
  })
  .strict();

/**
 * Parses a multipart field that arrives as a JSON string — Multer flattens
 * every non-file field to a string, so an array field has to be sent
 * JSON.stringify'd and reconstructed here before the array schema runs.
 */
function jsonArrayField(itemSchema, max) {
  return z
    .preprocess((val) => {
      if (Array.isArray(val)) return val;
      if (typeof val !== 'string' || val.trim() === '') return [];
      try {
        return JSON.parse(val);
      } catch {
        return val; // let the array schema below reject non-arrays with a real error
      }
    }, z.array(itemSchema).max(max))
    .optional();
}

/** POST /agents/:agentName/knowledge-base/extract (multipart — optional 'video' file). */
const extractKnowledgeBaseBody = z
  .object({
    text_samples: jsonArrayField(z.string().trim().min(1).max(20000), MAX_TEXT_SAMPLES),
    links: jsonArrayField(z.string().trim().url().max(2000), MAX_LINKS),
    image_paths: jsonArrayField(z.string().trim().min(1).max(500), MAX_IMAGES),
    youtube_links: jsonArrayField(z.string().trim().url().max(500), MAX_YOUTUBE_LINKS),
  })
  .strict();

const KNOWLEDGE_TYPES = [
  'fact',
  'strategy',
  'procedure',
  'observation',
  'hypothesis',
  'opinion',
  'guideline',
  'terminology',
  'pattern',
  'source_reliability',
];

/** POST /agents/:agentName/knowledge-base/confirm */
const confirmKnowledgeBatchBody = z
  .object({
    // Batch-level target — 'global' makes every accepted item in this batch
    // visible to every agent, not just the one being taught. Defaults to
    // 'agent' in the controller/service when omitted (existing behavior,
    // unchanged for any caller that doesn't send it).
    scope: z.enum(['global', 'agent']).optional(),
    items: z
      .array(
        z
          .object({
            decision: z.enum(['accept', 'skip']),
            category: z.string().trim().min(1).max(100).optional(),
            topic: z.string().trim().min(1).max(255).optional(),
            claim: z.string().trim().min(1).max(500).optional(),
            evidence: z.string().trim().max(500).nullable().optional(),
            knowledge_type: z.enum(KNOWLEDGE_TYPES).optional(),
            source_type: z
              .enum(['youtube', 'web_link', 'image', 'video', 'manual_text', 'outcome_feedback'])
              .optional(),
            source_id: z.coerce.number().int().positive().nullable().optional(),
            chunk_ids: z.array(z.coerce.number().int().positive()).max(50).nullable().optional(),
            verdict: z.enum(['new', 'supports', 'contradicts', 'duplicate']).optional(),
            related_id: z.coerce.number().int().positive().nullable().optional(),
          })
          .strict()
      )
      .min(1)
      .max(20),
  })
  .strict();

/** POST /agents/:agentName/dismiss */
const dismissChangeBody = z
  .object({
    trace_id: traceIdField,
    setting_key: z.string().trim().max(150).optional(),
    proposed_value: z.any().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// P1-A: recommendation approval/rejection (services/agents/recommendationDecisions.js)
// ---------------------------------------------------------------------------

/** POST /agents/recommendations/:id/approve|reject — id is a route param, never trusted from the body. */
const recommendationIdParams = z
  .object({
    id: z.coerce.number().int().positive(),
  })
  .strict();

/** GET /agents/recommendations */
const listRecommendationsQuery = z
  .object({
    status: z.enum(['recommended', 'approved', 'rejected']).optional(),
    agent_name: z.enum(Object.values(AGENT_NAMES)).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// P1-B: recommendation action tracking (services/agents/recommendationActions.js)
// ---------------------------------------------------------------------------

/** GET /agents/recommendations/:id/actions, POST /agents/recommendations/:id/actions */
const recommendationActionsParams = z
  .object({
    id: z.coerce.number().int().positive(),
  })
  .strict();

/** POST /agents/recommendations/:id/actions */
const createRecommendationActionBody = z
  .object({
    action_type: z.string().trim().min(1).max(100),
    parameters: z.record(z.any()).optional(),
    trace_id: traceIdField,
  })
  .strict();

/** POST /agents/recommendation-actions/:id/complete|fail|cancel — id is a route param, never trusted from the body. */
const recommendationActionIdParams = z
  .object({
    id: z.coerce.number().int().positive(),
  })
  .strict();

/** POST /agents/recommendation-actions/:id/complete */
const completeRecommendationActionBody = z
  .object({
    result_summary: z.record(z.any()).optional(),
  })
  .strict();

/** POST /agents/recommendation-actions/:id/fail */
const failRecommendationActionBody = z
  .object({
    error: z.string().trim().max(2000).optional(),
  })
  .strict();

// POST /agents/recommendation-actions/:id/execute (P1-B4) reuses
// recommendationActionIdParams for params and has no body — result_summary
// is server-computed only, same precedent as the /cancel route below.

/** GET /agents/knowledge-usage */
const knowledgeUsageQuery = z
  .object({
    trace_id: z.string().uuid(),
  })
  .strict();

// ---------------------------------------------------------------------------
// P4-D: learning candidate review (services/agents/learningCandidateDecisions.js)
// ---------------------------------------------------------------------------

/** GET /agents/learning-candidates */
const listLearningCandidatesQuery = z
  .object({
    status: z.enum(['pending_review', 'confirmed', 'rejected']).optional(),
    agent_name: z.enum(Object.values(AGENT_NAMES)).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

/** POST /agents/learning-candidates/:id/confirm|reject — id is a route param, never trusted from the body. */
const learningCandidateIdParams = z
  .object({
    id: z.coerce.number().int().positive(),
  })
  .strict();

/**
 * POST /agents/learning-candidates/:id/confirm
 *
 * `scope` defaults to 'agent' (matching confirmKnowledgeBatchBody's own
 * default) when omitted — 'global' must be an explicit, deliberate choice
 * by the human reviewing this candidate, never inferred or defaulted to.
 */
const confirmLearningCandidateBody = z
  .object({
    scope: z.enum(['agent', 'global']).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// P5-D: Intelligence Observatory (services/agents/observatory.js) — every
// route here is GET-only, read-only, no side effects.
// ---------------------------------------------------------------------------

/** GET /agents/observatory/activity */
const observatoryActivityQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

/** GET /agents/observatory/knowledge-health, GET /agents/observatory/knowledge-nodes */
const observatoryAgentQuery = z
  .object({
    agent_name: z.enum(Object.values(AGENT_NAMES)).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();

/** GET /agents/observatory/knowledge/:id/connections */
const observatoryKnowledgeIdParams = z
  .object({
    id: z.coerce.number().int().positive(),
  })
  .strict();

module.exports = {
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
};
