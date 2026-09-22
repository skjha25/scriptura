'use strict';

/**
 * Shared structured-recommendation tool — lets a read-only, non-action-taking
 * agent record "here is a suggested action" as a durable, traceable row
 * (agent_recommendations, via services/agents/recommendations.js — the SAME
 * persistence path P0 built, not a second one) instead of only ever saying
 * it in prose.
 *
 * Mirrors sharedKnowledgeTools.js's factory shape exactly: `agentName` is
 * always taken from the closure (baked in when registry.js calls
 * `makeRecommendationTools(AGENT_NAMES.X)`), never from model-supplied tool
 * input, for the same reason sharedKnowledgeTools.js gives — a crafted
 * prompt must never be able to attribute a recommendation to a different agent.
 *
 * ---------------------------------------------------------------------------
 * WHY type:'recommendation', NOT type:'proposed_change'
 * ---------------------------------------------------------------------------
 * Every `proposed_change` in this codebase is a current_value -> proposed_value
 * diff with a real Apply button and a real apply endpoint behind it
 * (POST /agents/settings/apply or /agents/proposals/apply). A suggested SEO
 * action ("add FAQ coverage to Article #42") is not a diff and has no apply
 * endpoint — reusing `proposed_change` would render a real Apply button that
 * 400s when clicked. A distinct type keeps this non-executable by
 * construction: runAgentTurn.js's handling for this type never pushes into
 * `proposedChanges` and never calls settingProposed (see that file).
 *
 * ---------------------------------------------------------------------------
 * EVIDENCE IS POINTERS ONLY
 * ---------------------------------------------------------------------------
 * `evidence_refs` never carries copied SERP/GSC/knowledge data — only
 * `{type, id}` / `{type, trace_id}` references the model cites from what it
 * already saw earlier in this same turn. Nothing here verifies a cited id was
 * actually retrieved this turn — these are CLAIMED references, not validated
 * evidence (that check is explicitly deferred, not built here).
 */

const RECOMMENDATION_MAX_CHARS = 500;
const RATIONALE_MAX_CHARS = 1000;
const EVIDENCE_REF_TYPES = ['serp_snapshot', 'gsc_snapshot', 'agent_knowledge', 'agent_knowledge_usage'];
const EXPECTED_DIRECTIONS = ['increase', 'decrease', 'no_change'];
const MAX_EVIDENCE_REFS = 10;

/** Keeps only well-formed evidence_ref entries — malformed entries are dropped, not fatal to the whole call. */
function sanitizeEvidenceRefs(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((ref) => ref && typeof ref === 'object' && EVIDENCE_REF_TYPES.includes(ref.type))
    .map((ref) => {
      const clean = { type: ref.type };
      if (ref.type === 'agent_knowledge_usage') {
        if (typeof ref.trace_id === 'string' && ref.trace_id.trim()) clean.trace_id = ref.trace_id.trim();
      } else if (Number.isFinite(Number(ref.id))) {
        clean.id = Number(ref.id);
      }
      // A ref missing its required identifier (no id / no trace_id) carries no
      // information — drop it rather than storing an empty pointer.
      return clean.id !== undefined || clean.trace_id !== undefined ? clean : null;
    })
    .filter(Boolean)
    .slice(0, MAX_EVIDENCE_REFS);
}

function makeRecommendationTools(agentName) {
  const recommendSeoAction = {
    name: 'recommend_seo_action',
    description:
      'Record a structured, traceable SEO/content recommendation — a genuine "we should do X" suggestion, ' +
      'not a routine observation or a data summary. Use this ONLY when you have a specific, actionable ' +
      "recommendation backed by evidence you actually saw earlier in THIS conversation (this turn's tool " +
      'results) — never invent or guess at evidence_refs, and never call this just to restate numbers ' +
      'already shown. This never executes or applies anything — it only records the recommendation for ' +
      'later human/agent review, the same way every proposal in this app requires an explicit human step ' +
      'before anything real changes. Not every turn needs this; most analysis questions do not.',
    input_schema: {
      type: 'object',
      properties: {
        recommendation: {
          type: 'string',
          description: 'The specific suggested action, e.g. "Add an FAQ section to Article #42 covering X."',
        },
        rationale: {
          type: 'string',
          description: 'Why — how the evidence you cite in evidence_refs supports this specific suggestion.',
        },
        target_ref: {
          type: 'object',
          description: 'Whichever identifiers are actually relevant, e.g. {blog_id}, {keyword}, {page_url}.',
          properties: {
            blog_id: { type: 'integer' },
            keyword: { type: 'string' },
            page_url: { type: 'string' },
          },
        },
        evidence_refs: {
          type: 'array',
          description:
            "Pointers to evidence you actually saw earlier in this turn — never invented. Use " +
            '{"type":"serp_snapshot","id":N} / {"type":"gsc_snapshot","id":N} (the snapshot_id a prior tool ' +
            'result gave you), {"type":"agent_knowledge","id":N} (a specific claim\'s id), or ' +
            '{"type":"agent_knowledge_usage","trace_id":"..."} to cite everything retrieved this conversation.',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: EVIDENCE_REF_TYPES },
              id: { type: 'integer' },
              trace_id: { type: 'string' },
            },
            required: ['type'],
          },
        },
        expected_metric: {
          type: 'string',
          description: 'Optional: what metric this should move, e.g. "gsc_impressions" or "serp_position". Free text — not limited to a fixed list.',
        },
        expected_direction: {
          type: 'string',
          enum: EXPECTED_DIRECTIONS,
          description: 'Optional: which way expected_metric should move.',
        },
        expected_change: {
          type: 'number',
          description: 'Optional: rough expected magnitude of change, if you have a defensible basis for one.',
        },
        observation_window_days: {
          type: 'integer',
          minimum: 1,
          maximum: 365,
          description: 'Optional: how long a real observation window would need to be to judge this.',
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Optional: your confidence in this specific recommendation, 0-1.',
        },
      },
      required: ['recommendation', 'rationale'],
    },
    async execute({
      recommendation,
      rationale,
      target_ref,
      evidence_refs,
      expected_metric,
      expected_direction,
      expected_change,
      observation_window_days,
      confidence,
    } = {}) {
      const trimmedRecommendation = String(recommendation || '').trim();
      const trimmedRationale = String(rationale || '').trim();
      if (!trimmedRecommendation) throw new Error('recommendation is required.');
      if (!trimmedRationale) throw new Error('rationale is required.');

      // Target identifiers are spread onto `change` at the TOP level (blog_id/
      // keyword/page_url), not nested under a target_ref sub-key — matching
      // every other proposed_change-family tool's convention (cluster_id,
      // block_id, style, etc. all sit directly on `change`), which is what lets
      // services/agents/recommendations.js's existing TARGET_REF_KEYS-based
      // extraction lift them with no logic changes beyond the whitelist itself.
      const cleanTargetRef =
        target_ref && typeof target_ref === 'object' && !Array.isArray(target_ref)
          ? Object.fromEntries(Object.entries(target_ref).filter(([, v]) => v !== undefined && v !== null && v !== ''))
          : {};

      const change = {
        domain: 'seo_recommendation',
        action: 'recommend_content_action',
        ...cleanTargetRef,
        recommendation: trimmedRecommendation.slice(0, RECOMMENDATION_MAX_CHARS),
        rationale: trimmedRationale.slice(0, RATIONALE_MAX_CHARS),
        evidence_refs: sanitizeEvidenceRefs(evidence_refs),
        // current_value/proposed_value kept null for shape-consistency with every
        // other tool result this codebase's generic payload logging expects to
        // see — never rendered as a diff since this never reaches proposedChanges.
        current_value: null,
        proposed_value: trimmedRecommendation.slice(0, RECOMMENDATION_MAX_CHARS),
        expected_metric: typeof expected_metric === 'string' && expected_metric.trim() ? expected_metric.trim().slice(0, 100) : null,
        expected_direction: EXPECTED_DIRECTIONS.includes(expected_direction) ? expected_direction : null,
        expected_change: Number.isFinite(expected_change) ? expected_change : null,
        observation_window_days: Number.isInteger(observation_window_days) ? observation_window_days : null,
        confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : null,
      };

      return {
        type: 'recommendation',
        change,
        message: `Recommended: ${change.recommendation}`,
      };
    },
  };

  return [recommendSeoAction];
}

module.exports = { makeRecommendationTools, EVIDENCE_REF_TYPES, EXPECTED_DIRECTIONS };
