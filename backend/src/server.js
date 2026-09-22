// backend/src/server.js
'use strict';

/**
 * Process entrypoint: boots the HTTP server and owns the shutdown lifecycle.
 *
 * Startup deliberately fails fast on a bad database connection rather than
 * accepting traffic and 500-ing every request, so a misconfigured deployment is
 * obvious immediately instead of at first use.
 */

const config = require('./config');
const logger = require('./utils/logger');
const { createApp } = require('./app');
const { sequelize, assertConnection } = require('./config/database');
const { ensureStorageReady } = require('./services/storage');
const { startScheduledPublisher } = require('./services/scheduledPublisher');
const { startAutopilotScheduler } = require('./services/autopilotScheduler');
const { startOutcomeEvaluationScheduler } = require('./services/outcomeEvaluationScheduler');
const { startLearningCandidateScheduler } = require('./services/learningCandidateScheduler');
const { startGscSyncScheduler } = require('./services/gscSyncScheduler');
const { reapStaleGenerations } = require('./services/generation');
const youtubeTranscriptProvider = require('./services/agents/knowledge/youtubeTranscriptProvider');

/** Surfaces the config warnings collected at load time, once, on boot. */
function reportWarnings() {
  if (config.warnings.length === 0) return;
  logger.warn(`Configuration notices (${config.warnings.length}):`);
  config.warnings.forEach((warning) => logger.warn(`  • ${warning}`));
}

async function start() {
  reportWarnings();

  let dsn;
  try {
    dsn = await assertConnection();
  } catch (err) {
    logger.error(
      'Could not connect to the database. Check DB_HOST / DB_NAME / DB_USER / ' +
        'DB_PASSWORD in backend/.env, and that the server is reachable.',
      err
    );
    process.exit(1);
  }

  // Creates the uploads root if missing so the first image write cannot fail on
  // a fresh checkout.
  await ensureStorageReady();

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(`Scriptura API listening on port ${config.port} [${config.env}]`);
    logger.info(`  database      ${dsn}`);
    logger.info(`  api           ${config.appUrl}${config.apiPrefix}`);
    if (!config.isProduction) logger.info(`  api docs      ${config.appUrl}/api-docs`);
    logger.info(`  cors origin   ${JSON.stringify(config.corsOrigin)}`);
    logger.info(
      `  ai providers  text=${config.ai.textProvider} image=${config.ai.imageProvider}`
    );
    logger.info(
      `  serpapi       ${config.serp.enabled ? 'enabled' : 'disabled'}` +
        (config.serp.flagEnabled && !config.serp.hasKey ? ' (flag on, key missing)' : '')
    );
    logger.info(
      `  scheduler     ${config.scheduler.enabled ? `enabled (${config.scheduler.cronExpression})` : 'disabled'}`
    );
    logger.info(
      `  autopilot     ${config.autopilot.enabled ? `enabled (${config.autopilot.cronExpression})` : 'disabled'}`
    );
    logger.info(
      `  outcome eval  ${config.outcomeEvaluation.enabled ? `enabled (${config.outcomeEvaluation.cronExpression})` : 'disabled'}`
    );
    logger.info(
      `  learn cand.   ${config.learningCandidates.enabled ? `enabled (${config.learningCandidates.cronExpression})` : 'disabled'}`
    );
    logger.info(
      `  gsc sync      ${config.gscSync.enabled ? `enabled (${config.gscSync.cronExpression})` : 'disabled'}`
    );
  });

  // Slightly above a typical 60s ALB idle timeout so the load balancer, not the
  // app, is the one to close idle connections.
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;

  // Flips SCHEDULED blogs to PUBLISHED once their publish_date arrives. See
  // services/scheduledPublisher.js. Returns null (and logs why) when disabled.
  const scheduledPublisherTask = startScheduledPublisher();

  // Recover any generations left in 'generating' state due to a previous crash.
  try {
    await reapStaleGenerations();
  } catch (err) {
    logger.error('Failed to reap stale generations on startup', err);
  }

  // Triggers blog generation for cluster keywords whose scheduled_generation_date
  // has arrived. See services/autopilotScheduler.js.
  const autopilotTask = startAutopilotScheduler();

  // P2-C: evaluates recommendation_outcomes rows whose observation window
  // has elapsed. See services/outcomeEvaluationScheduler.js.
  const outcomeEvaluationTask = startOutcomeEvaluationScheduler();

  // P4-B: detects learning candidates from already-evaluated outcomes. See
  // services/learningCandidateScheduler.js.
  const learningCandidateTask = startLearningCandidateScheduler();

  // Daily automatic GSC snapshot refresh — the "Sync now" button's automatic
  // counterpart. See services/gscSyncScheduler.js.
  const gscSyncTask = startGscSyncScheduler();

  // --- Graceful shutdown -----------------------------------------------------
  // Stop accepting connections, let in-flight requests finish, then close the
  // pool. A hard ceiling prevents a stuck request from blocking a deploy.
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received — shutting down gracefully.`);

    const forceExit = setTimeout(() => {
      logger.error('Shutdown timed out after 15s — forcing exit.');
      process.exit(1);
    }, 15000);
    forceExit.unref();

    if (scheduledPublisherTask) scheduledPublisherTask.stop();
    if (autopilotTask) autopilotTask.stop();
    if (outcomeEvaluationTask) outcomeEvaluationTask.stop();
    if (learningCandidateTask) learningCandidateTask.stop();
    if (gscSyncTask) gscSyncTask.stop();

    server.close(async (err) => {
      if (err) logger.error('Error while closing the HTTP server.', err);
      try {
        // Avoids leaking a headless Chromium process across restarts/deploys
        // — only actually launched if a YouTube transcript was ever fetched.
        await youtubeTranscriptProvider.closeBrowser();
        await sequelize.close();
        logger.info('Database connections closed. Bye.');
      } catch (closeErr) {
        logger.error('Error while closing database connections.', closeErr);
      }
      clearTimeout(forceExit);
      process.exit(err ? 1 : 0);
    });
  }

  ['SIGTERM', 'SIGINT'].forEach((signal) => process.on(signal, () => shutdown(signal)));

  // A promise rejection or thrown error that reaches here means state is
  // unknown. Log it and let the supervisor restart us rather than limping on.
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection — shutting down.', reason);
    shutdown('unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception — shutting down.', err);
    shutdown('uncaughtException');
  });

  return server;
}

// Only self-start when run directly (`node src/server.js`), so requiring this
// file from a script or test does not bind a port.
if (require.main === module) {
  start();
}

module.exports = { start };
