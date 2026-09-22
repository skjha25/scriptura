'use strict';

/**
 * P4-B: the scheduled job that periodically runs pattern detection over
 * already-evaluated outcome data. Same in-process node-cron shape as
 * services/scheduledPublisher.js/autopilotScheduler.js/
 * outcomeEvaluationScheduler.js.
 *
 * Runs weekly by default, deliberately decoupled from the daily outcome
 * evaluation cadence — a slow aggregation pass here can never delay
 * individual outcome evaluations, and detection is meaningful on a much
 * longer horizon than a single day's newly-evaluated outcomes.
 *
 * `detectLearningCandidates` (services/agents/learningCandidates.js) is
 * itself idempotent (pattern_key + status:'pending_review' check-then-create
 * guard), so this wrapper needs no additional claim/lock logic of its own —
 * unlike outcomeEvaluationScheduler.js's per-row `evaluation_attempts`
 * claim, a re-run here simply skips every pattern that already has an open
 * candidate.
 */

const logger = require('../utils/logger');

/**
 * Starts the cron job that calls `detectLearningCandidates` on an interval.
 * Same thin-wrapper shape as the other schedulers — the tick body is caught
 * so one bad tick never kills future ticks.
 *
 * @returns {import('node-cron').ScheduledTask|null} null when disabled.
 */
function startLearningCandidateScheduler() {
  const config = require('../config');
  if (!config.learningCandidates.enabled) {
    logger.info('Learning candidate scheduler disabled (LEARNING_CANDIDATES_ENABLED=false or NODE_ENV=test).');
    return null;
  }

  const cron = require('node-cron');
  if (!cron.validate(config.learningCandidates.cronExpression)) {
    logger.error(
      `Invalid LEARNING_CANDIDATES_CRON expression "${config.learningCandidates.cronExpression}" — learning candidate scheduler not started.`
    );
    return null;
  }

  const task = cron.schedule(
    config.learningCandidates.cronExpression,
    async () => {
      try {
        const { detectLearningCandidates } = require('./agents/learningCandidates');
        const result = await detectLearningCandidates({ groupBy: 'action_type' });
        if (result.created.length > 0 || result.skipped.length > 0) {
          logger.info(
            `Learning candidate detection: ${result.created.length} created, ${result.skipped.length} skipped.`
          );
        }
      } catch (err) {
        logger.error('Learning candidate detection tick failed.', err);
      }
    },
    { timezone: config.learningCandidates.timezone }
  );

  logger.info(
    `Learning candidate scheduler started (cron "${config.learningCandidates.cronExpression}", ${config.learningCandidates.timezone}).`
  );

  return task;
}

module.exports = {
  startLearningCandidateScheduler,
};
