'use strict';

/**
 * P4-D: the human-review gate for a detected learning candidate —
 * "Human review remains mandatory before a candidate can become
 * shared/global knowledge."
 *
 * Mirrors recommendationDecisions.js's guarded state machine exactly
 * (WHERE-guarded update, idempotent on repeat, 409 on a conflicting
 * terminal state, no reopen mechanism):
 *
 *   pending_review --confirm--> confirmed  (terminal)
 *   pending_review --reject-->  rejected   (terminal)
 *   confirmed --confirm--> confirmed (idempotent no-op)
 *   rejected  --reject-->  rejected  (idempotent no-op)
 *   any other combination --> 409 conflict
 *
 * ---------------------------------------------------------------------------
 * DETECTION != TEACHING — confirmLearningCandidate is the ONLY bridge
 * ---------------------------------------------------------------------------
 * This file NEVER writes to `agent_knowledge` directly. Confirming a
 * candidate calls the existing, completely unmodified
 * `knowledgeBase.confirmKnowledgeBatch()` — the SAME function
 * `POST /agents/:agentName/knowledge-base/confirm` already uses for
 * hand-taught knowledge. One write path for agent_knowledge, unchanged by
 * this phase.
 *
 * `scope` defaults to `'agent'` here too, unless the caller explicitly
 * passes `'global'` — there is no automatic promotion path anywhere in this
 * file. A human reviewing a candidate makes that choice explicitly (via
 * whatever UI eventually calls this — reusing the exact same
 * Global/Agent decision AgentKnowledgePage.js's existing Teach flow already
 * makes, not a new mechanism).
 *
 * ---------------------------------------------------------------------------
 * P5-C: CONTRADICTION DETECTION FOR OUTCOME-DERIVED KNOWLEDGE
 * ---------------------------------------------------------------------------
 * Before P5-C, `confirmLearningCandidate` always passed `verdict:'new'` to
 * `confirmKnowledgeBatch` — a candidate for a pattern that already has
 * confirmed, OPPOSITE-direction knowledge would silently become a second,
 * unrelated `agent_knowledge` row, never flagged. This closes that gap by
 * reusing `knowledgeBase.js`'s own EXISTING `contradicts` verdict branch
 * (unmodified — see its header comment) instead of inventing a second
 * contradiction mechanism: when the candidate being confirmed contradicts
 * the most recent CONFIRMED candidate for the exact same `pattern_key` +
 * `agent_name`, this passes `verdict:'contradicts'` instead of `'new'`.
 * `confirmKnowledgeBatch` then does exactly what it already does for the
 * hand-taught Teach flow — creates a new row, flags BOTH rows
 * `status:'contested'`, links them via `related_knowledge_ids` in both
 * directions, changes nothing else on the older row (not its `scope`, not
 * its `confidence` — see `knowledgeStore.updateKnowledge`'s field
 * whitelist), and picks no winner. A human resolves it later exactly the
 * way any other contested pair is resolved today — this file adds no new
 * resolution mechanism.
 *
 * IDENTITY: exact `pattern_key` string equality (the same deterministic
 * field P4's own dedup fix already keys on) plus `agent_name` as a
 * defense-in-depth second filter — `pattern_key` already embeds
 * `agent_name`, so this can never cross an agent boundary. No fuzzy/topic-text
 * matching, no embedding similarity.
 *
 * DIRECTION: recomputed from each candidate's own stored `improved_count`/
 * `declined_count`/`sample_size` via `learningCandidates.evaluateCandidateEligibility`
 * — the EXACT SAME deterministic formula P4 already uses to decide whether a
 * pattern is eligible at all. Never string-matched out of free-text `claim`,
 * never LLM-judged.
 *
 * THRESHOLD: no new constant. A `pending_review` candidate can only exist at
 * all if it already crossed P4's existing `MIN_SAMPLE_SIZE_FOR_CANDIDATE`/
 * `CANDIDATE_RATE_THRESHOLD` bar — "insufficient sample" cases never reach
 * this file because `detectLearningCandidates` never created a candidate for
 * them in the first place.
 *
 * LIVENESS: only a prior confirmed row whose resulting `agent_knowledge` row
 * is STILL `status:'confirmed'` (not already `outdated`/`contested`/etc.) is
 * treated as a live contradiction target — avoids re-contesting something
 * already flagged or retired.
 */

const ApiError = require('../../utils/ApiError');

async function transition(id, { toStatus, patch = {}, conflictCode, userId }) {
  const { LearningCandidate } = require('../../models');

  const row = await LearningCandidate.findByPk(id);
  if (!row) {
    throw ApiError.notFound(`Learning candidate #${id} not found.`, { code: 'LEARNING_CANDIDATE_NOT_FOUND' });
  }

  if (row.status === toStatus) return row; // already in the target state — safe no-op
  if (row.status !== 'pending_review') {
    throw ApiError.conflict(`Learning candidate #${id} is already ${row.status} and cannot be marked ${toStatus}.`, {
      code: conflictCode,
      details: { id, status: row.status },
    });
  }

  const [affected] = await LearningCandidate.update(
    { status: toStatus, reviewed_by: userId || null, reviewed_at: new Date(), ...patch },
    { where: { id, status: 'pending_review' } }
  );

  await row.reload();

  if (affected === 0) {
    // Lost the race to a concurrent request — re-derive from the row's
    // actual current state rather than assuming which side won.
    if (row.status === toStatus) return row;
    throw ApiError.conflict(`Learning candidate #${id} is already ${row.status} and cannot be marked ${toStatus}.`, {
      code: conflictCode,
      details: { id, status: row.status },
    });
  }

  return row;
}

/**
 * Direction ('improved'|'declined') a learning_candidates row represents,
 * recomputed from its own stored counts via the exact same deterministic
 * formula `detectLearningCandidates` used to decide eligibility in the first
 * place — never inferred from free text, never LLM-judged. Exported for
 * direct unit testing.
 *
 * @param {{sample_size:number, improved_count:number, declined_count:number}} candidate
 * @returns {'improved'|'declined'|null}
 */
function candidateDirection(candidate) {
  const { evaluateCandidateEligibility } = require('./learningCandidates');
  const eligibility = evaluateCandidateEligibility({
    sample_size: candidate.sample_size,
    improved: candidate.improved_count,
    declined: candidate.declined_count,
  });
  return eligibility ? eligibility.direction : null;
}

/**
 * Finds the most recent CONFIRMED learning_candidate for the exact same
 * `pattern_key` + `agent_name` as `candidate` whose direction is the
 * OPPOSITE of `candidate`'s own — i.e. a genuine contradiction, per the
 * header comment's IDENTITY/DIRECTION/THRESHOLD/LIVENESS rules. Returns
 * `null` when there is nothing to contradict (no prior confirmed candidate
 * for this pattern, same direction, or the prior one's resulting knowledge
 * row is no longer in the plain `confirmed` state). Exported for direct unit
 * testing.
 *
 * @param {import('../../models').LearningCandidate} candidate
 * @returns {Promise<{candidate: import('../../models').LearningCandidate, knowledgeId: number}|null>}
 */
async function findContradictingConfirmedCandidate(candidate) {
  const { LearningCandidate, AgentKnowledge } = require('../../models');
  const { Op } = require('sequelize');

  const thisDirection = candidateDirection(candidate);
  if (!thisDirection) return null; // defensive — should never happen for a real pending_review row

  const priorConfirmed = await LearningCandidate.findOne({
    where: {
      pattern_key: candidate.pattern_key,
      agent_name: candidate.agent_name,
      status: 'confirmed',
      id: { [Op.ne]: candidate.id },
      confirmed_knowledge_id: { [Op.ne]: null },
    },
    order: [
      ['created_at', 'DESC'],
      ['id', 'DESC'],
    ],
  });
  if (!priorConfirmed) return null;

  const priorDirection = candidateDirection(priorConfirmed);
  if (!priorDirection || priorDirection === thisDirection) return null; // same direction, or indeterminate -> not a contradiction

  // Liveness + compatible-category/type check: a P4-confirmed row starts
  // `status:'unverified'` (knowledgeBase.js's own 'new' branch — see its
  // header comment) and may later become 'confirmed'/'supported' via a
  // human corroboration; any of those are still a live, active claim worth
  // contesting. Only skip a row that is ALREADY flagged/retired
  // ('contested'/'outdated'/legacy 'contradicted') — never pile a second
  // contradiction onto one already surfaced, and never touch a hand-taught
  // row this mechanism has no business matching against.
  const ALREADY_FLAGGED_STATUSES = ['contested', 'outdated', 'contradicted'];
  const knowledgeRow = await AgentKnowledge.findByPk(priorConfirmed.confirmed_knowledge_id);
  if (!knowledgeRow || ALREADY_FLAGGED_STATUSES.includes(knowledgeRow.status)) return null;
  if (knowledgeRow.category !== 'outcome_pattern' || knowledgeRow.knowledge_type !== 'pattern') return null;

  return { candidate: priorConfirmed, knowledgeId: knowledgeRow.id };
}

/**
 * Confirms a learning candidate — the one path that turns a detected
 * pattern into a real `agent_knowledge` row, via the existing
 * `confirmKnowledgeBatch` writer.
 *
 * @param {number|string} id
 * @param {object} [options]
 * @param {'agent'|'global'} [options.scope] Defaults to 'agent' — 'global' only if explicitly requested.
 * @param {number|null} [options.userId]
 * @returns {Promise<import('../../models').LearningCandidate>}
 */
async function confirmLearningCandidate(id, { scope, userId } = {}) {
  const { LearningCandidate } = require('../../models');
  const knowledgeBase = require('./knowledge/knowledgeBase');

  const row = await LearningCandidate.findByPk(id);
  if (!row) {
    throw ApiError.notFound(`Learning candidate #${id} not found.`, { code: 'LEARNING_CANDIDATE_NOT_FOUND' });
  }

  // Idempotent no-op — matches transition()'s own same-state-repeat
  // convention used everywhere else in this codebase (completeAction,
  // executeAction, approveRecommendation). Checked BEFORE the pending-only
  // guard below, and before confirmKnowledgeBatch is ever called, so a
  // repeat confirm never creates a second agent_knowledge row for the same
  // candidate — unlike a plain status flip, re-running the knowledge write
  // is not naturally safe to repeat.
  if (row.status === 'confirmed') return row;

  if (row.status !== 'pending_review') {
    throw ApiError.conflict(`Learning candidate #${id} is already ${row.status} and cannot be confirmed.`, {
      code: 'LEARNING_CANDIDATE_NOT_PENDING',
      details: { id, status: row.status },
    });
  }

  // Never 'global' unless explicitly requested — same default posture as
  // confirmKnowledgeBatch's own `scope = 'agent'` parameter default.
  const finalScope = scope === 'global' ? 'global' : 'agent';

  // P5-C: reuses knowledgeBase.js's existing 'contradicts' verdict branch —
  // see this file's header comment — instead of always confirming as 'new'.
  const contradiction = await findContradictingConfirmedCandidate(row);

  const result = await knowledgeBase.confirmKnowledgeBatch(
    {
      agentName: row.agent_name,
      scope: finalScope,
      items: [
        {
          decision: 'accept',
          verdict: contradiction ? 'contradicts' : 'new',
          related_id: contradiction ? contradiction.knowledgeId : undefined,
          category: row.category,
          topic: row.topic,
          claim: row.claim,
          evidence: row.evidence,
          knowledge_type: 'pattern',
          source_type: 'outcome_feedback',
        },
      ],
    },
    { userId }
  );

  const knowledgeRow = result.created[0] || null;

  return transition(id, {
    toStatus: 'confirmed',
    patch: { confirmed_knowledge_id: knowledgeRow ? knowledgeRow.id : null },
    conflictCode: 'LEARNING_CANDIDATE_NOT_PENDING',
    userId,
  });
}

async function rejectLearningCandidate(id, { userId } = {}) {
  return transition(id, {
    toStatus: 'rejected',
    conflictCode: 'LEARNING_CANDIDATE_NOT_PENDING',
    userId,
  });
}

async function listLearningCandidates({ status, agentName, limit = 50 } = {}) {
  const { LearningCandidate } = require('../../models');
  const where = {};
  if (status) where.status = status;
  if (agentName) where.agent_name = agentName;
  return LearningCandidate.findAll({
    where,
    order: [['created_at', 'DESC']],
    limit: Math.min(Math.max(Number(limit) || 50, 1), 200),
  });
}

module.exports = {
  confirmLearningCandidate,
  rejectLearningCandidate,
  listLearningCandidates,
  candidateDirection,
  findContradictingConfirmedCandidate,
};
