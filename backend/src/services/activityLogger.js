'use strict';

/**
 * Structured activity logger — writes generation lifecycle events to the
 * `scriptura_logs` table for permanent monitoring and audit.
 *
 * Every method is fire-and-forget by design: a logging failure must never
 * break the generation pipeline. Errors are caught internally and emitted to
 * the console logger, so observability degrades gracefully rather than
 * causing a user-visible error.
 *
 * Usage:
 *   const activity = require('./activityLogger');
 *   await activity.generationCompleted({ blogId, ... });
 */

const logger = require('../utils/logger');
const { LOG_EVENT_TYPES, LOG_STATUS, LOG_TRIGGERED_BY } = require('../constants');

/** @returns {import('../models').ScripturaLog} */
function getModel() {
  return require('../models').ScripturaLog;
}

/**
 * Internal helper — creates a log row, swallowing errors.
 * @param {object} data
 */
async function safeCreate(data) {
  try {
    const ScripturaLog = getModel();
    await ScripturaLog.create(data);
  } catch (err) {
    logger.error('activityLogger: failed to write log entry', {
      event_type: data.event_type,
      error: err.message,
    });
  }
}

// ---------------------------------------------------------------------------
// Generation lifecycle
// ---------------------------------------------------------------------------

/**
 * Log: generation request queued.
 */
async function generationQueued({ blogId, clusterId, keywordId, userId, metadata } = {}) {
  await safeCreate({
    blog_id: blogId || null,
    cluster_id: clusterId || null,
    keyword_id: keywordId || null,
    event_type: LOG_EVENT_TYPES.GENERATION_QUEUED,
    status: LOG_STATUS.INFO,
    message: `Blog #${blogId} queued for generation.`,
    triggered_by: userId ? LOG_TRIGGERED_BY.USER : LOG_TRIGGERED_BY.AUTOPILOT,
    user_id: userId || null,
    metadata: metadata || null,
  });
}

/**
 * Log: generation actually started (provider call in flight).
 */
async function generationStarted({ blogId, clusterId, keywordId, provider, metadata } = {}) {
  await safeCreate({
    blog_id: blogId || null,
    cluster_id: clusterId || null,
    keyword_id: keywordId || null,
    event_type: LOG_EVENT_TYPES.GENERATION_STARTED,
    status: LOG_STATUS.INFO,
    message: `Blog #${blogId} generation started (provider: ${provider || 'unknown'}).`,
    provider: provider || null,
    metadata: metadata || null,
  });
}

/**
 * Log: generation completed successfully.
 */
async function generationCompleted({
  blogId,
  clusterId,
  keywordId,
  userId,
  provider,
  durationMs,
  wordCount,
  seoScore,
  aeoScore,
  geoScore,
  blockCount,
  metadata,
} = {}) {
  const durationSec = durationMs ? (durationMs / 1000).toFixed(1) : '?';
  await safeCreate({
    blog_id: blogId || null,
    cluster_id: clusterId || null,
    keyword_id: keywordId || null,
    event_type: LOG_EVENT_TYPES.GENERATION_COMPLETED,
    status: LOG_STATUS.SUCCESS,
    message: `Blog #${blogId} generated successfully in ${durationSec}s — ${wordCount || 0} words, SEO: ${seoScore ?? '-'}.`,
    duration_ms: durationMs || null,
    word_count: wordCount || null,
    seo_score: seoScore ?? null,
    aeo_score: aeoScore ?? null,
    geo_score: geoScore ?? null,
    block_count: blockCount || null,
    triggered_by: userId ? LOG_TRIGGERED_BY.USER : LOG_TRIGGERED_BY.AUTOPILOT,
    user_id: userId || null,
    provider: provider || null,
    metadata: metadata || null,
  });
}

/**
 * Log: generation failed.
 */
async function generationFailed({
  blogId,
  clusterId,
  keywordId,
  userId,
  provider,
  durationMs,
  error,
  metadata,
} = {}) {
  const durationSec = durationMs ? (durationMs / 1000).toFixed(1) : '?';
  await safeCreate({
    blog_id: blogId || null,
    cluster_id: clusterId || null,
    keyword_id: keywordId || null,
    event_type: LOG_EVENT_TYPES.GENERATION_FAILED,
    status: LOG_STATUS.FAILURE,
    message: `Blog #${blogId} generation failed after ${durationSec}s.`,
    error_message: error?.message ? error.message.slice(0, 2000) : null,
    error_stack: process.env.NODE_ENV !== 'production' ? (error?.stack || '').slice(0, 5000) : null,
    duration_ms: durationMs || null,
    triggered_by: userId ? LOG_TRIGGERED_BY.USER : LOG_TRIGGERED_BY.AUTOPILOT,
    user_id: userId || null,
    provider: provider || null,
    metadata: metadata || null,
  });
}

// ---------------------------------------------------------------------------
// Autopilot events
// ---------------------------------------------------------------------------

/**
 * Log: autopilot picked a keyword for generation.
 */
async function autopilotTriggered({ clusterId, keywordId, keyword, scheduledDate, metadata } = {}) {
  await safeCreate({
    cluster_id: clusterId || null,
    keyword_id: keywordId || null,
    event_type: LOG_EVENT_TYPES.AUTOPILOT_TRIGGERED,
    status: LOG_STATUS.INFO,
    message: `Autopilot triggered for keyword "${keyword}" (scheduled: ${scheduledDate || 'now'}).`,
    triggered_by: LOG_TRIGGERED_BY.AUTOPILOT,
    metadata: { keyword, scheduled_date: scheduledDate, ...metadata },
  });
}

/**
 * Log: autopilot created a blog row.
 */
async function autopilotBlogCreated({ blogId, clusterId, keywordId, keyword, title, metadata } = {}) {
  await safeCreate({
    blog_id: blogId || null,
    cluster_id: clusterId || null,
    keyword_id: keywordId || null,
    event_type: LOG_EVENT_TYPES.AUTOPILOT_BLOG_CREATED,
    status: LOG_STATUS.SUCCESS,
    message: `Autopilot created blog #${blogId} — "${title}" for keyword "${keyword}".`,
    triggered_by: LOG_TRIGGERED_BY.AUTOPILOT,
    metadata: { keyword, title, ...metadata },
  });
}

/**
 * Log: autopilot skipped a keyword (already in progress, conflict, etc.)
 */
async function autopilotSkipped({ clusterId, keywordId, keyword, reason, metadata } = {}) {
  await safeCreate({
    cluster_id: clusterId || null,
    keyword_id: keywordId || null,
    event_type: LOG_EVENT_TYPES.AUTOPILOT_SKIPPED,
    status: LOG_STATUS.WARNING,
    message: `Autopilot skipped keyword "${keyword}" — ${reason}.`,
    triggered_by: LOG_TRIGGERED_BY.AUTOPILOT,
    metadata: { keyword, reason, ...metadata },
  });
}

/**
 * Log: autopilot retrying a previously failed keyword.
 */
async function autopilotRetry({ clusterId, keywordId, keyword, retryCount, maxRetries, metadata } = {}) {
  await safeCreate({
    cluster_id: clusterId || null,
    keyword_id: keywordId || null,
    event_type: LOG_EVENT_TYPES.AUTOPILOT_RETRY,
    status: LOG_STATUS.WARNING,
    message: `Autopilot retry ${retryCount}/${maxRetries} for keyword "${keyword}".`,
    triggered_by: LOG_TRIGGERED_BY.AUTOPILOT,
    metadata: { keyword, retry_count: retryCount, max_retries: maxRetries, ...metadata },
  });
}

// ---------------------------------------------------------------------------
// Scheduled publisher events
// ---------------------------------------------------------------------------

/**
 * Log: scheduled publisher published a blog.
 */
async function scheduledPublish({ blogId, title, metadata } = {}) {
  await safeCreate({
    blog_id: blogId || null,
    event_type: LOG_EVENT_TYPES.SCHEDULED_PUBLISH,
    status: LOG_STATUS.SUCCESS,
    message: `Blog #${blogId} ("${title}") published on schedule.`,
    triggered_by: LOG_TRIGGERED_BY.SCHEDULER,
    metadata: metadata || null,
  });
}

/**
 * Log: scheduled publisher skipped a blog (not ready).
 */
async function publishSkipped({ blogId, title, reason, metadata } = {}) {
  await safeCreate({
    blog_id: blogId || null,
    event_type: LOG_EVENT_TYPES.PUBLISH_SKIPPED,
    status: LOG_STATUS.WARNING,
    message: `Blog #${blogId} ("${title}") publish skipped — ${reason}.`,
    triggered_by: LOG_TRIGGERED_BY.SCHEDULER,
    metadata: { reason, ...metadata },
  });
}

/**
 * Log: stale generation recovered.
 */
async function reapStale({ blogId, metadata } = {}) {
  await safeCreate({
    blog_id: blogId || null,
    event_type: LOG_EVENT_TYPES.REAP_STALE,
    status: LOG_STATUS.WARNING,
    message: `Blog #${blogId} generation was stale and recovered to failed.`,
    triggered_by: LOG_TRIGGERED_BY.SYSTEM,
    metadata: metadata || null,
  });
}

// ---------------------------------------------------------------------------
// Generic
// ---------------------------------------------------------------------------

/**
 * Write a custom log entry.
 */
async function log({ eventType, status, blogId, clusterId, keywordId, message, userId, provider, metadata } = {}) {
  await safeCreate({
    blog_id: blogId || null,
    cluster_id: clusterId || null,
    keyword_id: keywordId || null,
    event_type: eventType,
    status: status || LOG_STATUS.INFO,
    message: message || null,
    triggered_by: userId ? LOG_TRIGGERED_BY.USER : LOG_TRIGGERED_BY.SYSTEM,
    user_id: userId || null,
    provider: provider || null,
    metadata: metadata || null,
  });
}

module.exports = {
  generationQueued,
  generationStarted,
  generationCompleted,
  generationFailed,
  autopilotTriggered,
  autopilotBlogCreated,
  autopilotSkipped,
  autopilotRetry,
  scheduledPublish,
  publishSkipped,
  reapStale,
  log,
};
