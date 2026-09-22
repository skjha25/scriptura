'use strict';

/**
 * P5-A + P5-B: closes the retrieval-only learning loop identified in the P5
 * architecture audit —
 *
 *   recommendation -> action -> evaluated outcome
 *     -> the exact agent_knowledge rows actually retrieved for that
 *        recommendation's own trace_id
 *     -> bounded success/failure reinforcement
 *
 * This is RETRIEVAL-ONLY learning. It never creates, deletes, or reclassifies
 * an agent_knowledge row; never changes `scope`, `agent_name`, `claim`,
 * `evidence`, `category`, `topic`, `status`, `knowledge_type`,
 * `related_knowledge_ids`, `version`, or `supersedes_id`; never touches a
 * system prompt or a tool definition; never bypasses the
 * recommendation/action approval or execution gates (this file is only ever
 * called AFTER an outcome has already been finalized by
 * outcomeEvaluationScheduler.js — it reads, it never approves/executes/
 * confirms anything). The only fields it ever writes are `success_count`,
 * `failure_count`, and `confidence` — see knowledgeStore.js#reinforceKnowledge.
 *
 * ---------------------------------------------------------------------------
 * WHY trace_id, NOT recommendation_details.change.evidence_refs
 * ---------------------------------------------------------------------------
 * A recommendation's own `evidence_refs` (inside `recommendation_details.
 * change`) are LLM-CLAIMED, unvalidated — see sharedRecommendationTools.js's
 * own comment: "CLAIMED references, not validated evidence." Using them here
 * would let an LLM's own unverified citation decide which knowledge gets
 * reinforced. Instead this uses the join the P5 audit verified directly in
 * the codebase: `agent_knowledge_usage.trace_id` is written from the exact
 * same `traceId` that `agent_recommendations.trace_id` is written from —
 * both originate from the single per-turn id generated once in
 * runAgentTurn.js (`const id = traceId || crypto.randomUUID()`), so
 * `AgentKnowledgeUsage.findAll({ where: { trace_id } })` is a deterministic,
 * code-computed record of what was actually retrieved into context when
 * this recommendation was produced — never an LLM's own claim about it.
 *
 * Filtered additionally by `agent_name` (not just `trace_id`) because a
 * delegation chain can share one trace_id across multiple agents
 * (runAgentTurn.js's loadPriorMessages is explicitly scoped to
 * `(trace_id, agent_name)` for the same reason) — without this, a
 * recommendation from one agent could reinforce knowledge only ever
 * retrieved by a *different* agent earlier in the same shared trace. This
 * filter is what guarantees "another agent's knowledge remains unchanged."
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENCY — NO NEW TABLE, NO NEW COLUMN
 * ---------------------------------------------------------------------------
 * This module has no idempotency logic of its own, and needs none: it is
 * only ever invoked from outcomeEvaluationScheduler.js#evaluateOutcome,
 * strictly gated on that function's own WHERE-guarded
 * `status:'pending' -> 'evaluated'` transition actually having affected a
 * row (`finalized === 1`). That WHERE clause can only ever match once per
 * outcome's lifetime — once `status` leaves `'pending'`, nothing in this
 * codebase ever sets it back, so no code path can invoke this module twice
 * for the same outcome, whether from a scheduler retry, an overlapping tick,
 * or a manual re-run. The existing claim mechanism (the same one that
 * already makes `evaluation_attempts` safe against double-processing) IS
 * this module's entire idempotency guarantee.
 *
 * ---------------------------------------------------------------------------
 * THE CONFIDENCE FORMULA, EXPLICITLY
 * ---------------------------------------------------------------------------
 * - MIN_REINFORCEMENT_SAMPLES = 3: a knowledge row's FIRST TWO qualifying
 *   (improved/declined) outcomes only move its counters — confidence is left
 *   completely untouched. This directly satisfies "a single outcome must
 *   never materially change confidence" (it changes it by exactly zero).
 * - POSITIVE_DELTA = NEGATIVE_DELTA = 0.03, applied once per qualifying
 *   event from the 3rd onward. Five times smaller than
 *   knowledgeBase.js#corroboratedConfidence's existing +0.15 human-corroboration
 *   bump — deliberately more conservative, because outcome observations for
 *   the same knowledge row can be correlated (the same keyword/action_type
 *   recurring) in a way an independent human confirm is not.
 * - Symmetric deltas mean an alternating success/failure stream nets to
 *   (at most) one delta's worth of drift regardless of length — "equal
 *   success/failure evidence must not produce directional drift."
 * - Bounds: [0, 0.95] — 0.95 matches corroboratedConfidence's own ceiling
 *   (outcome-derived reinforcement alone should never reach "certain"); 0 is
 *   the same floor `updateKnowledge`'s existing clamp already allows.
 * - No LLM anywhere in this file or in the formula — every number is a
 *   fixed arithmetic constant applied to real, already-classified counts.
 */

const logger = require('../../../utils/logger');
const knowledgeStore = require('./knowledgeStore');

/** Total qualifying (success+failure) observations required before a knowledge row's confidence moves at all. Below this, only the counters move. */
const MIN_REINFORCEMENT_SAMPLES = 3;

/** Per-event confidence nudge once MIN_REINFORCEMENT_SAMPLES is reached — see header comment for why this is 5x smaller than the existing human-corroboration bump. */
const POSITIVE_DELTA = 0.03;
const NEGATIVE_DELTA = 0.03;

/** Hard bounds — 0.95 mirrors corroboratedConfidence's own ceiling; outcome-derived reinforcement alone never reaches "certain". */
const MIN_CONFIDENCE = 0;
const MAX_CONFIDENCE = 0.95;

/**
 * Distinct agent_knowledge ids actually retrieved for this recommendation's
 * OWN agent, within its OWN trace. Never another agent's usage rows, even if
 * the trace is shared across a delegation chain. Deduped to one entry per
 * knowledge id — a conversation that re-retrieved the same row across
 * several turns of the same trace still counts as one reinforcement
 * opportunity per outcome, not one per retrieval, so a long back-and-forth
 * can't outweigh a short one.
 *
 * @param {{trace_id: string, agent_name: string}} recommendation
 * @returns {Promise<number[]>}
 */
async function findRetrievedKnowledgeIds(recommendation) {
  if (!recommendation?.trace_id || !recommendation?.agent_name) return [];
  const { AgentKnowledgeUsage } = require('../../../models');
  const rows = await AgentKnowledgeUsage.findAll({
    where: { trace_id: recommendation.trace_id, agent_name: recommendation.agent_name },
    attributes: ['knowledge_id'],
  });
  return Array.from(new Set(rows.map((r) => r.knowledge_id)));
}

/**
 * Applies P5 reinforcement for one finalized, classified outcome. See the
 * header comment for why this is safe to call at most once per outcome, and
 * for the exact confidence formula.
 *
 * @param {object} recommendation Real AgentRecommendation row (trace_id, agent_name).
 * @param {'improved'|'declined'|'neutral'|'inconclusive'} classification
 * @returns {Promise<{reinforcedIds: number[]}>} Which knowledge ids were actually touched — empty for neutral/inconclusive or when nothing was retrieved.
 */
async function applyOutcomeReinforcement(recommendation, classification) {
  // Retrieval-only learning boundary: neutral/inconclusive carries no
  // directional evidence, so it must never touch a counter or confidence —
  // not even usage_count.
  if (classification !== 'improved' && classification !== 'declined') {
    return { reinforcedIds: [] };
  }

  const knowledgeIds = await findRetrievedKnowledgeIds(recommendation);
  if (knowledgeIds.length === 0) return { reinforcedIds: [] };

  const success = classification === 'improved';
  const reinforcedIds = [];

  for (const knowledgeId of knowledgeIds) {
    try {
      // eslint-disable-next-line no-await-in-loop -- bounded by MAX_KNOWLEDGE_ITEMS_IN_PROMPT (8) per trace, sequential is fine for this admin-scale, low-concurrency job
      const updated = await knowledgeStore.reinforceKnowledge(knowledgeId, {
        success,
        minSamples: MIN_REINFORCEMENT_SAMPLES,
        positiveDelta: POSITIVE_DELTA,
        negativeDelta: NEGATIVE_DELTA,
        minConfidence: MIN_CONFIDENCE,
        maxConfidence: MAX_CONFIDENCE,
      });
      if (updated) reinforcedIds.push(knowledgeId);
    } catch (err) {
      // Best-effort, same posture as recordRecommendation/recordKnowledgeUsage/
      // captureBaseline elsewhere in this lifecycle — one row's reinforcement
      // failing must never fail outcome evaluation itself, and must never
      // stop the rest of this trace's knowledge from being reinforced.
      logger.warn('Knowledge reinforcement failed for one row — continuing.', {
        knowledgeId,
        message: err.message,
      });
    }
  }

  return { reinforcedIds };
}

module.exports = {
  applyOutcomeReinforcement,
  findRetrievedKnowledgeIds,
  MIN_REINFORCEMENT_SAMPLES,
  POSITIVE_DELTA,
  NEGATIVE_DELTA,
  MIN_CONFIDENCE,
  MAX_CONFIDENCE,
};
