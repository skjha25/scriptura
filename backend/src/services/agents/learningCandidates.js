'use strict';

/**
 * P4-B: "P4 may IDENTIFY potential learning. P4 must NOT automatically
 * TEACH the system."
 *
 * OUTCOME HISTORY (P2) -> PATTERN DETECTION (this file) -> LEARNING
 * CANDIDATE -> [P4-D] HUMAN REVIEW -> CONFIRM/REJECT.
 *
 * Pattern detection is a deterministic aggregation over P3-A's
 * `getActionTypeEffectiveness` — it does not reimplement that aggregation,
 * does not call an AI provider, and does not invent a number. If an LLM
 * were ever added to author the optional `reasoning` narrative (P4-C, not
 * built here — `reasoning` stays NULL), it would still never be allowed to
 * write `sample_size`, the count columns, `confidence`, or `evidence_refs`
 * — those are always this file's own arithmetic, from real stored rows.
 *
 * ---------------------------------------------------------------------------
 * WHY DETECTION RUNS PER-AGENT
 * ---------------------------------------------------------------------------
 * A newly detected candidate is ALWAYS created with `scope:'agent'` and a
 * real, non-null `agent_name` — never `scope:'global'` (that is only ever
 * chosen by an explicit human decision at confirm time, see
 * learningCandidateDecisions.js). Since an agent-scoped candidate needs a
 * specific agent to attribute it to, detection calls
 * `getActionTypeEffectiveness({..., agentName})` once per known agent
 * (skipping Generate Agent, which does not participate in the knowledge
 * system at all — the same exclusion sharedKnowledgeTools.js already makes)
 * rather than once globally across every agent's recommendations. This also
 * means two different agents observing the same action_type pattern get two
 * separate, independently-reviewable candidates — no cross-agent
 * contamination structurally, not just by convention.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENCY / DEDUPLICATION
 * ---------------------------------------------------------------------------
 * `pattern_key` (e.g. "action_type:seo_analyst_agent:blog.update_seo_fields")
 * is the deterministic identity for one agent's pattern on one dimension
 * value. Before creating a row, this file looks at the MOST RECENT existing
 * candidate for that `pattern_key` — regardless of its status — and:
 *   - if it is still `pending_review`, skips (`reason:'already_pending'`):
 *     one open review item per pattern at a time, full stop;
 *   - otherwise (it is `confirmed` or `rejected`, i.e. terminal) compares
 *     its `evidence_refs` (normalized to a sorted set of
 *     recommendation_outcome ids) against the newly detected evidence: if
 *     they are IDENTICAL, skips (`reason:'no_new_evidence'`) — a pattern
 *     already put in front of a human does not get re-presented with the
 *     exact same proof just because a fresh detection run happened. If the
 *     new evidence contains genuinely new outcome ids, a new candidate is
 *     created as usual.
 * A rejected or confirmed candidate is never re-created purely because
 * detection ran again; it is only re-created once real new evidence exists.
 * Same accepted check-then-create posture (no DB unique constraint)
 * already used by recommendationActions.js's own "one pending action per
 * recommendation" guard — see the migration.
 */

const logger = require('../../utils/logger');

/** Below this many total (evaluated + inconclusive) outcomes for a pattern, no candidate is created — "no candidate from a single successful action" and, more generally, no candidate from a thin sample. */
const MIN_SAMPLE_SIZE_FOR_CANDIDATE = 5;

/** A pattern must cross this share of ALL outcomes (not just decidable ones) in one direction to be flagged — a clear majority, not a coin flip. Applied symmetrically to both "tends to improve" and "tends to decline" detection. */
const CANDIDATE_RATE_THRESHOLD = 0.6;

/**
 * Whether one P3-A breakdown entry crosses the detection threshold, and in
 * which direction. Pure function, no I/O — trivially unit-testable on its
 * own.
 *
 * @param {{sample_size:number, improved:number, declined:number}} entry
 * @returns {{direction:'improved'|'declined', rate:number}|null}
 */
function evaluateCandidateEligibility(entry) {
  if (entry.sample_size < MIN_SAMPLE_SIZE_FOR_CANDIDATE) return null;

  // "No candidate from inconclusive-only outcomes" — if nothing in the
  // sample ever resolved to a clear direction, there is no decidable
  // evidence at all, regardless of how large the sample is.
  const decidable = entry.improved + entry.declined;
  if (decidable === 0) return null;

  const improvedRate = entry.improved / entry.sample_size;
  const declinedRate = entry.declined / entry.sample_size;

  if (improvedRate >= CANDIDATE_RATE_THRESHOLD) return { direction: 'improved', rate: improvedRate };
  if (declinedRate >= CANDIDATE_RATE_THRESHOLD) return { direction: 'declined', rate: declinedRate };
  return null;
}

/** Deterministic, code-generated claim text — never LLM-authored. Kept well under confirmKnowledgeBatchBody's 500-char claim limit so a confirm never fails validation. */
function buildClaim({ dimensionValue, direction, rate, sampleSize }) {
  const verb = direction === 'improved' ? 'tended to improve the target metric' : 'tended to decline the target metric';
  return `Across ${sampleSize} observed outcomes, action type "${dimensionValue}" ${verb} in ${Math.round(rate * 100)}% of cases.`;
}

/** Deterministic, code-generated evidence sentence restating the real counts — never LLM-authored. */
function buildEvidence(entry) {
  return (
    `improved: ${entry.improved}, declined: ${entry.declined}, neutral: ${entry.neutral}, ` +
    `inconclusive: ${entry.inconclusive} (sample_size: ${entry.sample_size}).`
  );
}

/**
 * Extracts and sorts the recommendation_outcome ids out of a
 * `learning_candidates.evidence_refs` array — the deterministic identity of
 * "which evidence was this candidate based on", independent of insertion
 * order. Exported for direct unit testing.
 *
 * @param {Array<{type:string, id:number}>} evidenceRefs
 * @returns {number[]}
 */
function normalizeEvidenceIds(evidenceRefs) {
  return (evidenceRefs || [])
    .map((ref) => Number(ref?.id))
    .filter((id) => Number.isFinite(id))
    .sort((a, b) => a - b);
}

/**
 * Whether two already-sorted id arrays represent the exact same evidence
 * set. Exported for direct unit testing.
 *
 * @param {number[]} idsA
 * @param {number[]} idsB
 * @returns {boolean}
 */
function sameEvidenceIds(idsA, idsB) {
  if (idsA.length !== idsB.length) return false;
  return idsA.every((id, i) => id === idsB[i]);
}

/**
 * Detects and persists learning candidates from already-evaluated outcome
 * data. Best-effort per agent — one agent's query failing does not stop
 * detection for the rest (mirrors evaluateDueOutcomes' own per-row
 * isolation in outcomeEvaluationScheduler.js).
 *
 * @param {object} [input]
 * @param {'action_type'|'recommendation_type'} [input.groupBy='action_type']
 * @returns {Promise<{created: Array, skipped: Array<{agentName:string, dimensionValue:string, reason:string}>}>}
 */
async function detectLearningCandidates({ groupBy = 'action_type' } = {}) {
  const { AGENT_NAMES } = require('../../constants');
  const { getActionTypeEffectiveness } = require('./recommendationEvaluation');
  const { LearningCandidate } = require('../../models');

  const created = [];
  const skipped = [];

  for (const agentName of Object.values(AGENT_NAMES)) {
    // Generate Agent keeps its own separate style-profile mechanism and was
    // never wired into the shared knowledge tools — same exclusion applies here.
    if (agentName === AGENT_NAMES.GENERATE) continue;

    let breakdown;
    try {
      // eslint-disable-next-line no-await-in-loop -- small, bounded (8 agents), admin-scale batch job, same sequential-loop style as autopilotScheduler.js/outcomeEvaluationScheduler.js
      breakdown = await getActionTypeEffectiveness({ groupBy, agentName });
    } catch (err) {
      logger.error(`Learning candidate detection failed for agent "${agentName}".`, { message: err.message });
      // eslint-disable-next-line no-continue
      continue;
    }

    // eslint-disable-next-line no-restricted-syntax -- sequential DB checks per entry, same reasoning as the outer loop
    for (const entry of breakdown) {
      const eligibility = evaluateCandidateEligibility(entry);
      if (!eligibility) {
        skipped.push({ agentName, dimensionValue: entry.dimension_value, reason: 'below_threshold' });
        // eslint-disable-next-line no-continue
        continue;
      }

      const patternKey = `${groupBy}:${agentName}:${entry.dimension_value}`;

      // eslint-disable-next-line no-await-in-loop
      const mostRecent = await LearningCandidate.findOne({
        where: { pattern_key: patternKey },
        order: [['created_at', 'DESC'], ['id', 'DESC']],
      });

      const newEvidenceIds = normalizeEvidenceIds(
        (entry.outcome_ids || []).map((id) => ({ id }))
      );

      if (mostRecent) {
        if (mostRecent.status === 'pending_review') {
          skipped.push({ agentName, dimensionValue: entry.dimension_value, reason: 'already_pending' });
          // eslint-disable-next-line no-continue
          continue;
        }

        // Terminal (confirmed/rejected) — only block re-creation when the
        // evidence is exactly the same as what was already reviewed.
        const priorEvidenceIds = normalizeEvidenceIds(mostRecent.evidence_refs);
        if (sameEvidenceIds(priorEvidenceIds, newEvidenceIds)) {
          skipped.push({ agentName, dimensionValue: entry.dimension_value, reason: 'no_new_evidence' });
          // eslint-disable-next-line no-continue
          continue;
        }
      }

      try {
        // eslint-disable-next-line no-await-in-loop
        const row = await LearningCandidate.create({
          pattern_key: patternKey,
          scope: 'agent', // NEVER 'global' here — see the header comment and learningCandidateDecisions.js
          agent_name: agentName,
          category: 'outcome_pattern',
          topic: entry.dimension_value,
          claim: buildClaim({ dimensionValue: entry.dimension_value, direction: eligibility.direction, rate: eligibility.rate, sampleSize: entry.sample_size }),
          evidence: buildEvidence(entry),
          sample_size: entry.sample_size,
          improved_count: entry.improved,
          declined_count: entry.declined,
          neutral_count: entry.neutral,
          inconclusive_count: entry.inconclusive,
          confidence: eligibility.rate,
          evidence_refs: entry.outcome_ids.map((id) => ({ type: 'recommendation_outcome', id })),
          status: 'pending_review',
        });
        created.push(row);
      } catch (err) {
        // A genuine race (two ticks past the check-then-create window at
        // once) is the only realistic failure here — logged, not fatal to
        // the rest of the batch.
        logger.warn('Learning candidate creation failed — skipped, not fatal to the rest of detection.', {
          patternKey,
          message: err.message,
        });
        skipped.push({ agentName, dimensionValue: entry.dimension_value, reason: 'create_failed' });
      }
    }
  }

  return { created, skipped };
}

module.exports = {
  detectLearningCandidates,
  evaluateCandidateEligibility,
  normalizeEvidenceIds,
  sameEvidenceIds,
  MIN_SAMPLE_SIZE_FOR_CANDIDATE,
  CANDIDATE_RATE_THRESHOLD,
};
