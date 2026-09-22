'use strict';

/**
 * Daily GSC sync cron job — the automatic counterpart to the "Sync now"
 * button (controllers/gsc.controller.js). Refetches a fresh trailing-7-day
 * Search Analytics snapshot once a day so `gsc_snapshots` is never more than
 * a day stale, without an admin needing to remember to click Sync.
 *
 * Same "no queue, single instance, in-process node-cron" shape as every
 * other scheduler (see services/outcomeEvaluationScheduler.js). Gated by its
 * own GSC_SYNC_ENABLED flag rather than reusing config.gsc.enabled directly,
 * so an admin can turn the daily job off (e.g. to conserve API quota) while
 * keeping GSC itself enabled for the manual button and the agent tool.
 * Regardless, each tick still no-ops (not a startup failure) when GSC isn't
 * enabled/configured — the same deployment might enable GSC later without a
 * restart being guaranteed to happen first.
 */

const logger = require('../utils/logger');

/**
 * One sync attempt. Never throws — a failed tick must never crash the
 * process or stop future ticks; the caller only needs to know it happened.
 * Exported for direct testing/manual invocation.
 *
 * @returns {Promise<object|null>} The persisted snapshot, or null if skipped/failed.
 */
async function runGscSync() {
  const gsc = require('./gsc');

  if (!gsc.isEnabled()) {
    logger.info('GSC sync tick skipped — GSC is not enabled/configured.');
    return null;
  }

  const { start, end } = gsc.lastNDays(7);
  try {
    const snapshot = await gsc.fetchSearchAnalytics({ startDate: start, endDate: end });
    logger.info(
      `GSC sync: fetched ${snapshot.rows.length} rows for ${snapshot.site_url} (${start} → ${end}).`
    );
    return snapshot;
  } catch (err) {
    logger.error('GSC sync tick failed.', { message: err.message });
    return null;
  }
}

/**
 * Starts the cron job that calls `runGscSync` on an interval. Same
 * thin-wrapper shape as outcomeEvaluationScheduler's
 * startOutcomeEvaluationScheduler.
 *
 * @returns {import('node-cron').ScheduledTask|null} null when disabled.
 */
function startGscSyncScheduler() {
  const config = require('../config');
  if (!config.gscSync.enabled) {
    logger.info('GSC sync scheduler disabled (GSC_SYNC_ENABLED=false or NODE_ENV=test).');
    return null;
  }

  const cron = require('node-cron');
  if (!cron.validate(config.gscSync.cronExpression)) {
    logger.error(
      `Invalid GSC_SYNC_CRON expression "${config.gscSync.cronExpression}" — GSC sync scheduler not started.`
    );
    return null;
  }

  const task = cron.schedule(
    config.gscSync.cronExpression,
    async () => {
      try {
        await runGscSync();
      } catch (err) {
        logger.error('GSC sync tick failed.', err);
      }
    },
    { timezone: config.gscSync.timezone }
  );

  logger.info(
    `GSC sync scheduler started (cron "${config.gscSync.cronExpression}", ${config.gscSync.timezone}).`
  );

  return task;
}

module.exports = { runGscSync, startGscSyncScheduler };
