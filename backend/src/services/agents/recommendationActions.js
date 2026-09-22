'use strict';

/**
 * P1-B/B4: the execution-tracking layer for an already-approved
 * recommendation (services/agents/recommendationDecisions.js owns
 * approve/reject only — deliberately separate concerns, per the P1-B design
 * report §3/§5).
 *
 * An action is never auto-created by approval. A human explicitly starts
 * tracking one (createAction). From there:
 *   - If `actionType` is a registered, structured type (see
 *     actionExecutors.js), the row is created with `executor_type:
 *     'automated'` and a human later calls `executeAction` to actually
 *     perform the whitelisted Blog mutation — still human-gated, just not
 *     human-typed.
 *   - Otherwise, `executor_type:'manual'` — a human self-reports the outcome
 *     via completeAction/failAction/cancelAction, exactly as before this
 *     phase existed.
 *
 * Guarded state machine (mirrors recommendationDecisions.js's transition()
 * exactly — WHERE-guarded update, idempotent on repeat, 409 on a conflicting
 * terminal state, no reopen mechanism):
 *
 *   pending --complete--> completed   (terminal)
 *   pending --fail-->     failed      (terminal)
 *   pending --cancel-->   cancelled   (terminal)
 *   completed --complete--> completed (idempotent no-op)
 *   failed    --fail-->     failed    (idempotent no-op)
 *   cancelled --cancel-->   cancelled (idempotent no-op)
 *   any other terminal-vs-transition combination --> 409 conflict
 *
 * A failed/cancelled action has zero effect on the parent recommendation's
 * own status — nothing here ever writes back to agent_recommendations.
 */

const ApiError = require('../../utils/ApiError');
const { getExecutor } = require('./actionExecutors');
const outcomeMeasurement = require('./outcomeMeasurement');

async function createAction(recommendationId, { actionType, parameters, traceId } = {}) {
  const { AgentRecommendation, RecommendationAction } = require('../../models');

  const recommendation = await AgentRecommendation.findByPk(recommendationId);
  if (!recommendation) {
    throw ApiError.notFound(`Recommendation #${recommendationId} not found.`, { code: 'RECOMMENDATION_NOT_FOUND' });
  }
  if (recommendation.status !== 'approved') {
    throw ApiError.conflict(
      `Recommendation #${recommendationId} must be approved before an action can be tracked (current status: ${recommendation.status}).`,
      { code: 'RECOMMENDATION_NOT_APPROVED', details: { id: recommendationId, status: recommendation.status } }
    );
  }

  // Check-then-create: only one non-terminal (pending) action may exist per
  // recommendation at a time — a narrow theoretical race exists here (MySQL
  // has no partial-unique-index support for "unique only when pending"), but
  // this is a single-org, admin-only, low-concurrency tool, matching the
  // risk profile this codebase already accepts elsewhere (e.g.
  // clusterService.scheduleAll's non-transactional per-entry loop).
  const existingPending = await RecommendationAction.findOne({
    where: { recommendation_id: recommendationId, status: 'pending' },
  });
  if (existingPending) {
    throw ApiError.conflict(
      `Recommendation #${recommendationId} already has a pending action (#${existingPending.id}).`,
      { code: 'ACTION_ALREADY_PENDING', details: { id: existingPending.id } }
    );
  }

  // A retry after a failed/cancelled attempt lands here too — the guard
  // above only blocks a *pending* sibling, so once the prior attempt is
  // terminal this naturally serves as the retry path (see the design
  // report §11). attempt_number is explicit, not inferred from row order.
  const lastAttempt = await RecommendationAction.findOne({
    where: { recommendation_id: recommendationId },
    order: [['attempt_number', 'DESC']],
  });

  // P1-B4: a registered action_type gets real, whitelisted execution.
  // Everything else keeps the original manual, self-reported behavior —
  // zero regression for the existing action_type space.
  const executor = getExecutor(actionType);
  let cleanParameters = parameters || null;
  let executorType = 'manual';

  if (executor) {
    const parsed = executor.parametersSchema.safeParse(parameters || {});
    if (!parsed.success) {
      throw ApiError.unprocessable(`Invalid parameters for action_type "${actionType}".`, {
        code: 'INVALID_ACTION_PARAMETERS',
        details: parsed.error.flatten(),
      });
    }
    cleanParameters = parsed.data;
    executorType = 'automated';

    // An admin should not be able to silently redirect an approved
    // recommendation's execution at an unrelated blog — cross-check when the
    // recommendation actually carries a blog_id target (it's optional LLM
    // output, so this is a cross-check, not the source of truth; see
    // actionExecutors.js's parametersSchema for the real source of truth).
    const targetBlogId = recommendation.target_ref?.blog_id;
    if (targetBlogId !== undefined && targetBlogId !== null && Number(targetBlogId) !== Number(cleanParameters.blog_id)) {
      throw ApiError.conflict(
        `parameters.blog_id (${cleanParameters.blog_id}) does not match this recommendation's target blog (${targetBlogId}).`,
        { code: 'ACTION_TARGET_MISMATCH' }
      );
    }
  }

  return RecommendationAction.create({
    recommendation_id: recommendationId,
    action_type: actionType,
    parameters: cleanParameters,
    trace_id: traceId || recommendation.trace_id,
    attempt_number: lastAttempt ? lastAttempt.attempt_number + 1 : 1,
    status: 'pending',
    executor_type: executorType,
  });
}

async function transition(id, { toStatus, patch = {}, conflictCode, userId, rejectAutomated = false }) {
  const { RecommendationAction } = require('../../models');

  const row = await RecommendationAction.findByPk(id);
  if (!row) {
    throw ApiError.notFound(`Action #${id} not found.`, { code: 'ACTION_NOT_FOUND' });
  }

  // P1-B4: a human self-report (complete/fail) is not a valid way to close
  // out an automated action — it must go through executeAction, which is
  // the only path that ever calls transition() without this flag set. This
  // closes the "human fakes success via the self-report endpoint" hole.
  if (rejectAutomated && row.executor_type === 'automated') {
    throw ApiError.conflict(
      `Action #${id} is an automated action and must be executed via /execute, not self-reported.`,
      { code: 'ACTION_IS_AUTOMATED', details: { id } }
    );
  }

  if (row.status === toStatus) return row; // already in the target state — safe no-op
  if (row.status !== 'pending') {
    throw ApiError.conflict(`Action #${id} is already ${row.status} and cannot be marked ${toStatus}.`, {
      code: conflictCode,
      details: { id, status: row.status },
    });
  }

  const [affected] = await RecommendationAction.update(
    { status: toStatus, executed_by: userId || null, completed_at: new Date(), ...patch },
    { where: { id, status: 'pending' } }
  );

  await row.reload();

  if (affected === 0) {
    // Lost the race to a concurrent request — re-derive from the row's
    // actual current state rather than assuming which side won.
    if (row.status === toStatus) return row;
    throw ApiError.conflict(`Action #${id} is already ${row.status} and cannot be marked ${toStatus}.`, {
      code: conflictCode,
      details: { id, status: row.status },
    });
  }

  return row;
}

async function completeAction(id, { resultSummary, userId } = {}) {
  const updated = await transition(id, {
    toStatus: 'completed',
    patch: { result_summary: resultSummary || null },
    conflictCode: 'ACTION_NOT_PENDING',
    userId,
    rejectAutomated: true,
  });
  // P2-B: best-effort baseline capture — see outcomeMeasurement.js. Never
  // throws, never changes the row returned above.
  await outcomeMeasurement.captureBaselineForCompletedAction(updated);
  return updated;
}

async function failAction(id, { error, userId } = {}) {
  return transition(id, {
    toStatus: 'failed',
    patch: { error: error || null },
    conflictCode: 'ACTION_NOT_PENDING',
    userId,
    rejectAutomated: true,
  });
}

/**
 * P1-B4: perform the real, whitelisted Blog mutation for an automated
 * action, then finalize the row. Valid only for `status:'pending' &&
 * executor_type:'automated'` — calling this on anything else (including an
 * already-completed action) is a 409, never a silent no-op, because
 * re-running execute() would re-apply a real mutation.
 *
 * Concurrency without a new transaction/row-lock: `executed_by` (nullable,
 * otherwise unused until finalization) doubles as a claim mutex — only the
 * request whose WHERE-guarded update actually flips it from NULL proceeds to
 * run the mutation. Everyone else gets 409 without touching the blog.
 */
async function executeAction(id, { userId } = {}) {
  const { RecommendationAction, AgentRecommendation, Blog } = require('../../models');

  const row = await RecommendationAction.findByPk(id);
  if (!row) {
    throw ApiError.notFound(`Action #${id} not found.`, { code: 'ACTION_NOT_FOUND' });
  }
  if (row.executor_type !== 'automated') {
    throw ApiError.conflict(`Action #${id} is not an automated action and cannot be executed.`, {
      code: 'ACTION_NOT_AUTOMATED',
      details: { id, executor_type: row.executor_type },
    });
  }
  if (row.status !== 'pending') {
    throw ApiError.conflict(`Action #${id} is already ${row.status} and cannot be executed.`, {
      code: 'ACTION_NOT_PENDING',
      details: { id, status: row.status },
    });
  }

  const executor = getExecutor(row.action_type);
  if (!executor) {
    // Should be unreachable: createAction only sets executor_type:'automated'
    // when a registered executor was found for this action_type.
    throw ApiError.conflict(`No executor registered for action_type "${row.action_type}".`, { code: 'NO_EXECUTOR' });
  }

  const [claimed] = await RecommendationAction.update(
    { executed_by: userId || null },
    { where: { id, status: 'pending', executed_by: null } }
  );
  if (claimed === 0) {
    await row.reload();
    throw ApiError.conflict(`Action #${id} is already being executed or is no longer pending.`, {
      code: 'ACTION_ALREADY_CLAIMED',
      details: { id, status: row.status },
    });
  }

  const parameters = row.parameters || {};
  const blog = await Blog.findByPk(parameters.blog_id);
  if (!blog) {
    await transition(id, {
      toStatus: 'failed',
      patch: { error: `Blog #${parameters.blog_id} not found.` },
      conflictCode: 'ACTION_NOT_PENDING',
      userId,
    });
    throw ApiError.notFound(`Blog #${parameters.blog_id} not found.`, { code: 'BLOG_NOT_FOUND' });
  }

  let result;
  try {
    result = await executor.execute(blog, parameters);
  } catch (err) {
    await transition(id, {
      toStatus: 'failed',
      patch: { error: err.message || String(err) },
      conflictCode: 'ACTION_NOT_PENDING',
      userId,
    });
    throw err;
  }

  const resultSummary = {
    action_type: row.action_type,
    blog_id: blog.id,
    before: result.before,
    after: result.after,
    mutated_fields: result.mutatedFields,
    ...(result.scores ? { scores: result.scores } : {}),
    executed_at: new Date().toISOString(),
  };

  const updated = await transition(id, {
    toStatus: 'completed',
    patch: { result_summary: resultSummary },
    conflictCode: 'ACTION_NOT_PENDING',
    userId,
  });

  const recommendation = await AgentRecommendation.findByPk(row.recommendation_id);
  const agentActivity = require('../agentActivityLogger');
  await agentActivity.settingApplied({
    traceId: row.trace_id,
    agentName: recommendation?.agent_name,
    settingKey: row.action_type,
    previousValue: result.before,
    newValue: result.after,
    userId,
    metadata: { recommendation_action_id: row.id, recommendation_id: row.recommendation_id, blog_id: blog.id },
  });

  // P2-B: best-effort baseline capture — only after the real mutation above
  // has already succeeded. Never throws, never changes the row returned below.
  await outcomeMeasurement.captureBaselineForCompletedAction(updated);

  return updated;
}

async function cancelAction(id, { userId } = {}) {
  return transition(id, {
    toStatus: 'cancelled',
    patch: {},
    conflictCode: 'ACTION_NOT_PENDING',
    userId,
  });
}

async function listActions(recommendationId) {
  const { RecommendationAction } = require('../../models');
  return RecommendationAction.findAll({
    where: { recommendation_id: recommendationId },
    order: [['attempt_number', 'DESC']],
  });
}

module.exports = { createAction, completeAction, failAction, cancelAction, executeAction, listActions };
