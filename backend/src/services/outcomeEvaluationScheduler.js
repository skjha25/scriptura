'use strict';

/**
 * P2-C: the scheduled job that closes out the lifecycle P2-B started —
 * Recommendation → Approval → Action → Execution → Baseline Capture (P2-B)
 * → Observation Window → [THIS FILE: Measurement] → Outcome.
 *
 * Runs in-process via `node-cron`, same single-instance shape as
 * services/scheduledPublisher.js and services/autopilotScheduler.js. On each
 * tick: find `recommendation_outcomes` rows whose observation window has
 * elapsed (`status:'pending' && due_at <= now`), fetch FRESH evidence for
 * each one (reusing the exact same capture functions
 * services/agents/outcomeMeasurement.js already uses for baseline — those
 * functions just read current state, so calling them again later is
 * literally what "fresh" means here), compute a deterministic delta and
 * classification, and finalize the row.
 *
 * ---------------------------------------------------------------------------
 * EVERYTHING NUMERIC IS DETERMINISTIC — NO LLM CALL ANYWHERE IN THIS FILE
 * ---------------------------------------------------------------------------
 * `metric_deltas` is plain subtraction over real numbers already fetched by
 * services/serp.js / services/gsc.js / a live Blog read. `outcome`
 * (improved/declined/neutral/inconclusive) is a deterministic comparison
 * against the ONE metric the recommending agent actually named
 * (`expected_metric`/`expected_direction` on the parent recommendation) —
 * never a post-hoc pick among several observed metrics, and never a causal
 * claim ("the action caused this") — only a measured-state comparison.
 *
 * ---------------------------------------------------------------------------
 * CONCURRENCY: TWO OVERLAPPING TICKS CANNOT DOUBLE-EVALUATE ONE ROW
 * ---------------------------------------------------------------------------
 * `evaluation_attempts` doubles as a claim mutex, exactly like
 * recommendationActions.js#executeAction's `executed_by` — a WHERE-guarded
 * `UPDATE ... WHERE id=X AND status='pending' AND evaluation_attempts=N`
 * increments it; only the tick whose update actually affects a row proceeds
 * to fetch fresh evidence and finalize. No new lock/transaction, matching
 * this codebase's own accepted pattern for a low-concurrency, admin-scale tool.
 */

const logger = require('../utils/logger');

/** Below this relative movement, a delta is "no meaningful change" regardless of direction — classified neutral, not a coin-flip improved/declined. */
const NEUTRAL_THRESHOLD_RATIO = 0.05;

/** Fixed backoff between retry attempts on unresolved fresh evidence — bounded overall by config.outcomeEvaluation.maxAttempts, not retried forever. */
const RETRY_BACKOFF_DAYS = 1;

function isMeaningfulDelta(delta, baseline) {
  if (baseline === 0) return delta !== 0;
  return Math.abs(delta) / Math.abs(baseline) >= NEUTRAL_THRESHOLD_RATIO;
}

/**
 * Judges ONE metric's delta against the recommendation's own stated
 * expectation — never invents a "winner" among several observed metrics
 * when no expectation was named. Exported for direct unit testing.
 *
 * @param {Array<{metric:string, baseline:number, fresh:number, delta:number}>} metricDeltas
 * @param {string|null} expectedMetric
 * @param {string|null} expectedDirection 'increase'|'decrease'|'no_change'|null
 * @returns {'improved'|'declined'|'neutral'|'inconclusive'}
 */
function classifyOutcome(metricDeltas, expectedMetric, expectedDirection) {
  const normalizedExpected = typeof expectedMetric === 'string' && expectedMetric.trim() ? expectedMetric.trim().toLowerCase() : null;
  const named = normalizedExpected ? metricDeltas.find((d) => d.metric.toLowerCase() === normalizedExpected) : null;

  // Judge the one metric the agent explicitly named, or — only when exactly
  // one metric was observable at all — that one. With multiple observed
  // metrics and no named target, there is no honest way to pick a "winner".
  const judged = named || (metricDeltas.length === 1 ? metricDeltas[0] : null);
  if (!judged) return 'inconclusive';

  if (!isMeaningfulDelta(judged.delta, judged.baseline)) return 'neutral';

  if (expectedDirection === 'increase') return judged.delta > 0 ? 'improved' : 'declined';
  if (expectedDirection === 'decrease') return judged.delta < 0 ? 'improved' : 'declined';
  // 'no_change' expected but a real, meaningful move happened — we can say
  // it deviated from expectation, but not honestly say that's good or bad.
  // No expected_direction at all — a real delta exists but nothing to judge it against.
  return 'inconclusive';
}

/**
 * Fetches fresh evidence for one outcome's already-known target, reusing
 * the exact same capture functions baseline used. Returns the same
 * `{ref, metrics}[]` shape captureBaseline internally works with.
 * @private
 */
async function captureFreshEvidence({ blogId, keyword, pageUrl }) {
  const outcomeMeasurement = require('./agents/outcomeMeasurement');
  const [blogFresh, serpFresh, gscFresh] = await Promise.all([
    outcomeMeasurement.captureBlogScoreBaseline(blogId),
    outcomeMeasurement.captureSerpBaseline({ keyword, blogId }),
    outcomeMeasurement.captureGscBaseline({ pageUrl, keyword }),
  ]);
  return [blogFresh, serpFresh, gscFresh].filter(Boolean);
}

/**
 * Evaluates exactly one due outcome. Claims it first (WHERE-guarded
 * evaluation_attempts increment) so a concurrent tick can never process the
 * same row twice. Exported for direct unit testing.
 *
 * @param {import('../models').RecommendationOutcome} outcome
 * @returns {Promise<'evaluated'|'inconclusive'|'rescheduled'|'claimed_by_another_tick'>}
 */
async function evaluateOutcome(outcome) {
  const config = require('../config');
  const { RecommendationOutcome, AgentRecommendation, RecommendationAction } = require('../models');
  const outcomeMeasurement = require('./agents/outcomeMeasurement');

  const priorAttempts = outcome.evaluation_attempts;
  const nextAttempts = priorAttempts + 1;

  const [claimed] = await RecommendationOutcome.update(
    { evaluation_attempts: nextAttempts },
    { where: { id: outcome.id, status: 'pending', evaluation_attempts: priorAttempts } }
  );
  if (claimed === 0) return 'claimed_by_another_tick';

  const recommendation = await AgentRecommendation.findByPk(outcome.recommendation_id);
  const action = await RecommendationAction.findByPk(outcome.action_id);
  if (!recommendation || !action) {
    await RecommendationOutcome.update(
      { status: 'inconclusive', outcome: 'inconclusive', evaluated_at: new Date() },
      { where: { id: outcome.id } }
    );
    logger.warn(`Outcome #${outcome.id} finalized inconclusive — parent recommendation/action no longer exists.`);
    return 'inconclusive';
  }

  const blogId = outcomeMeasurement.resolveTargetBlogId(action, recommendation);
  const keyword = outcomeMeasurement.resolveTargetKeyword(recommendation);
  const pageUrl = outcomeMeasurement.resolveTargetPageUrl(recommendation);

  const freshResolved = await captureFreshEvidence({ blogId, keyword, pageUrl });

  const baselineByMetric = new Map((outcome.baseline_metric_snapshot || []).map((m) => [m.metric, m.value]));
  const freshByMetric = new Map(freshResolved.flatMap((r) => r.metrics).map((m) => [m.metric, m.value]));

  const metricDeltas = [];
  for (const [metric, baselineValue] of baselineByMetric) {
    if (!freshByMetric.has(metric)) continue; // this metric didn't resolve fresh this attempt — skipped, never fabricated
    const freshValue = freshByMetric.get(metric);
    metricDeltas.push({ metric, baseline: baselineValue, fresh: freshValue, delta: freshValue - baselineValue });
  }

  if (metricDeltas.length === 0) {
    if (nextAttempts >= config.outcomeEvaluation.maxAttempts) {
      await RecommendationOutcome.update(
        { status: 'inconclusive', outcome: 'inconclusive', evaluated_at: new Date() },
        { where: { id: outcome.id, status: 'pending' } }
      );
      logger.info(`Outcome #${outcome.id} finalized inconclusive after ${nextAttempts} attempts — no fresh evidence ever matched a baseline metric.`);
      return 'inconclusive';
    }
    await RecommendationOutcome.update(
      { due_at: new Date(Date.now() + RETRY_BACKOFF_DAYS * 24 * 60 * 60 * 1000) },
      { where: { id: outcome.id, status: 'pending' } }
    );
    logger.info(`Outcome #${outcome.id} rescheduled — no fresh evidence resolved this attempt (${nextAttempts}/${config.outcomeEvaluation.maxAttempts}).`);
    return 'rescheduled';
  }

  const classification = classifyOutcome(metricDeltas, recommendation.expected_metric, recommendation.expected_direction);
  const freshEvidenceRefs = freshResolved.map((r) => r.ref);

  const [finalized] = await RecommendationOutcome.update(
    {
      status: 'evaluated',
      fresh_evidence_refs: freshEvidenceRefs,
      metric_deltas: metricDeltas,
      outcome: classification,
      evaluated_at: new Date(),
    },
    { where: { id: outcome.id, status: 'pending' } }
  );

  // P5-A/B: knowledge reinforcement is gated on THIS exact WHERE-guarded
  // transition having actually won its race (finalized === 1) — the same
  // claim discipline already used for evaluation_attempts above. Because
  // `status:'pending'` can only ever match once per outcome's lifetime, this
  // is reinforcement's entire idempotency guarantee: it is reachable at most
  // once per outcome, with no new table/column required. See
  // knowledge/knowledgeReinforcement.js for the trace_id join and the exact,
  // bounded confidence formula. Best-effort — a reinforcement failure must
  // never affect this outcome's own finalized status.
  if (finalized === 1) {
    const knowledgeReinforcement = require('./agents/knowledge/knowledgeReinforcement');
    await knowledgeReinforcement.applyOutcomeReinforcement(recommendation, classification).catch((err) => {
      logger.warn(`Knowledge reinforcement failed for outcome #${outcome.id} — outcome finalization is unaffected.`, {
        message: err.message,
      });
    });
  }

  return 'evaluated';
}

/**
 * Finds every due, pending outcome (bounded by config.outcomeEvaluation.batchSize)
 * and evaluates each in turn. The testable unit — startOutcomeEvaluationScheduler()
 * below is just the cron wrapper around this.
 *
 * @returns {Promise<{evaluated:number, inconclusive:number, rescheduled:number, skipped:number, total:number}>}
 */
async function evaluateDueOutcomes() {
  const { Op } = require('sequelize');
  const config = require('../config');
  const { RecommendationOutcome } = require('../models');

  const due = await RecommendationOutcome.findAll({
    where: { status: 'pending', due_at: { [Op.lte]: new Date() } },
    order: [['due_at', 'ASC']],
    limit: config.outcomeEvaluation.batchSize,
  });

  const tally = { evaluated: 0, inconclusive: 0, rescheduled: 0, skipped: 0 };
  for (const outcome of due) {
    try {
      const result = await evaluateOutcome(outcome);
      if (result === 'claimed_by_another_tick') tally.skipped += 1;
      else tally[result] += 1;
    } catch (err) {
      // One row's failure must never stop the rest of the batch.
      logger.error(`Outcome evaluation failed for outcome #${outcome.id}.`, { message: err.message });
    }
  }

  if (due.length > 0) {
    logger.info(
      `Outcome evaluation: ${tally.evaluated} evaluated, ${tally.inconclusive} inconclusive, ` +
        `${tally.rescheduled} rescheduled, ${tally.skipped} claimed by another tick.`
    );
  }

  return { ...tally, total: due.length };
}

/**
 * Starts the cron job that calls `evaluateDueOutcomes` on an interval. Same
 * thin-wrapper shape as scheduledPublisher.js's startScheduledPublisher —
 * the tick body is caught so one bad tick never kills future ticks.
 *
 * @returns {import('node-cron').ScheduledTask|null} null when disabled.
 */
function startOutcomeEvaluationScheduler() {
  const config = require('../config');
  if (!config.outcomeEvaluation.enabled) {
    logger.info('Outcome evaluation scheduler disabled (OUTCOME_EVALUATION_ENABLED=false or NODE_ENV=test).');
    return null;
  }

  const cron = require('node-cron');
  if (!cron.validate(config.outcomeEvaluation.cronExpression)) {
    logger.error(
      `Invalid OUTCOME_EVALUATION_CRON expression "${config.outcomeEvaluation.cronExpression}" — outcome evaluation scheduler not started.`
    );
    return null;
  }

  const task = cron.schedule(
    config.outcomeEvaluation.cronExpression,
    async () => {
      try {
        await evaluateDueOutcomes();
      } catch (err) {
        logger.error('Outcome evaluation tick failed.', err);
      }
    },
    { timezone: config.outcomeEvaluation.timezone }
  );

  logger.info(
    `Outcome evaluation scheduler started (cron "${config.outcomeEvaluation.cronExpression}", ${config.outcomeEvaluation.timezone}).`
  );

  return task;
}

module.exports = {
  evaluateDueOutcomes,
  evaluateOutcome,
  classifyOutcome,
  startOutcomeEvaluationScheduler,
};
