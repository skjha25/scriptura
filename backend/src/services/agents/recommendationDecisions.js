'use strict';

/**
 * P1-A: the human decision step for a captured recommendation
 * (services/agents/recommendations.js owns capture; this file owns
 * approve/reject only — deliberately separate concerns, same split as
 * knowledgeExtraction.js vs. knowledgeBase.js's confirm path).
 *
 * Server-side guarded state machine, never trusting the client:
 *
 *   recommended --approve--> approved   (terminal)
 *   recommended --reject-->  rejected   (terminal)
 *   approved    --approve--> approved   (idempotent no-op)
 *   rejected    --reject-->  rejected   (idempotent no-op)
 *   approved    --reject-->  409 conflict (no reopen mechanism — by design)
 *   rejected    --approve--> 409 conflict (no reopen mechanism — by design)
 *
 * `decided_by` always comes from the caller's authenticated user id — never
 * from request input (see controllers/agents.controller.js's approve/reject
 * handlers, which pass req.user.id and nothing from req.body).
 *
 * This is P1-A's entire scope: no recommendation_actions row is created
 * here, no execution happens, no other table is touched. Approval only ever
 * changes THIS row.
 */

const ApiError = require('../../utils/ApiError');

/**
 * @private
 * @param {number} id
 * @param {object} opts
 * @param {'recommended'} opts.fromStatus Status this transition is valid from.
 * @param {'approved'|'rejected'} opts.toStatus Status to transition to.
 * @param {'approved'|'rejected'} opts.idempotentStatus Status that makes a repeat call a no-op.
 * @param {'approved'|'rejected'} opts.conflictStatus Status that makes this call an invalid transition.
 * @param {string} opts.conflictMessage
 * @param {string} opts.conflictCode
 * @param {number|null} opts.userId
 * @returns {Promise<object>} The recommendation row in its resulting state.
 */
async function transition(id, { fromStatus, toStatus, idempotentStatus, conflictStatus, conflictMessage, conflictCode, userId }) {
  const { AgentRecommendation } = require('../../models');

  const row = await AgentRecommendation.findByPk(id);
  if (!row) {
    throw ApiError.notFound(`Recommendation #${id} not found.`, { code: 'RECOMMENDATION_NOT_FOUND' });
  }

  if (row.status === idempotentStatus) return row; // already in the target state — safe no-op, no duplicate side effects
  if (row.status === conflictStatus) {
    throw ApiError.conflict(conflictMessage, { code: conflictCode, details: { id, status: row.status } });
  }

  // WHERE-guarded update rather than trusting the earlier findByPk read —
  // closes the race where two near-simultaneous requests (double-click,
  // network retry) both see 'recommended' before either writes.
  const [affected] = await AgentRecommendation.update(
    { status: toStatus, decided_by: userId || null, decided_at: new Date() },
    { where: { id, status: fromStatus } }
  );

  await row.reload();

  if (affected === 0) {
    // Lost the race — someone else's decision landed first. Re-derive the
    // correct response from the row's actual current state rather than
    // assuming which side won.
    if (row.status === idempotentStatus) return row;
    throw ApiError.conflict(conflictMessage, { code: conflictCode, details: { id, status: row.status } });
  }

  return row;
}

/**
 * @param {number} id
 * @param {object} opts
 * @param {number|null} opts.userId The authenticated admin's id (req.user.id) — never from request input.
 * @returns {Promise<object>}
 */
async function approveRecommendation(id, { userId } = {}) {
  return transition(id, {
    fromStatus: 'recommended',
    toStatus: 'approved',
    idempotentStatus: 'approved',
    conflictStatus: 'rejected',
    conflictMessage: `Recommendation #${id} was already rejected and cannot be approved.`,
    conflictCode: 'RECOMMENDATION_ALREADY_REJECTED',
    userId,
  });
}

/**
 * @param {number} id
 * @param {object} opts
 * @param {number|null} opts.userId The authenticated admin's id (req.user.id) — never from request input.
 * @returns {Promise<object>}
 */
async function rejectRecommendation(id, { userId } = {}) {
  return transition(id, {
    fromStatus: 'recommended',
    toStatus: 'rejected',
    idempotentStatus: 'rejected',
    conflictStatus: 'approved',
    conflictMessage: `Recommendation #${id} was already approved and cannot be rejected.`,
    conflictCode: 'RECOMMENDATION_ALREADY_APPROVED',
    userId,
  });
}

/**
 * GET-side helper for the "Pending Recommendations" UI — plain read, no
 * state change. Defaults to the recommended-only view the UI needs; a
 * status filter is accepted for completeness (e.g. an admin later wanting
 * to see what they already decided).
 */
async function listRecommendations({ status, agentName, limit = 50 } = {}) {
  const { AgentRecommendation } = require('../../models');
  const where = {};
  if (status) where.status = status;
  if (agentName) where.agent_name = agentName;

  return AgentRecommendation.findAll({
    where,
    order: [['created_at', 'DESC']],
    limit: Math.min(Math.max(1, Number(limit) || 50), 200),
  });
}

/**
 * Bulk decision: transitions every currently-`recommended` row to
 * `toStatus` in one write, not just the (at most 200) rows the "Pending
 * Recommendations" list happens to have loaded. Same terminal state machine
 * as the single-row `transition` above — only rows still in `recommended`
 * are touched, so an already-approved/rejected row is left exactly as a
 * human already decided it, never silently reopened or overwritten.
 *
 * @param {object} opts
 * @param {'approved'|'rejected'} opts.toStatus
 * @param {number|null} opts.userId The authenticated admin's id — never from request input.
 * @returns {Promise<{updated: number}>}
 */
async function bulkDecideRecommendations({ toStatus, userId } = {}) {
  const { AgentRecommendation } = require('../../models');

  const [updated] = await AgentRecommendation.update(
    { status: toStatus, decided_by: userId || null, decided_at: new Date() },
    { where: { status: 'recommended' } }
  );

  return { updated };
}

async function bulkApproveRecommendations({ userId } = {}) {
  return bulkDecideRecommendations({ toStatus: 'approved', userId });
}

async function bulkRejectRecommendations({ userId } = {}) {
  return bulkDecideRecommendations({ toStatus: 'rejected', userId });
}

module.exports = {
  approveRecommendation,
  rejectRecommendation,
  listRecommendations,
  bulkApproveRecommendations,
  bulkRejectRecommendations,
};
