'use strict';

/**
 * Scheduled-publish engine (Section 17.3 of the roadmap).
 *
 * `blog_status: SCHEDULED` + `publish_date` have existed in the data model
 * since Phase 0, but nothing ever acted on them — a scheduled blog stayed
 * scheduled until a human opened it and clicked publish. This module is the
 * missing background process: on a fixed interval it finds every blog whose
 * scheduled time has arrived and flips it live.
 *
 * Runs in-process via `node-cron`, consistent with the rest of the app's
 * single-instance model (see generation.js's reapStaleGenerations for the
 * same shape of "periodic maintenance function + a thin cron wrapper").
 * The eligibility check deliberately mirrors `blogService.assertPublishable`
 * so a blog can never go live automatically in a state the manual publish
 * button would have refused.
 */

const logger = require('../utils/logger');
const activity = require('./activityLogger');
const { BLOG_STATUS, GENERATION_STATUS } = require('../constants');

/**
 * Publishes every SCHEDULED blog whose `publish_date` has arrived and whose
 * content has finished generating.
 *
 * Eligibility (all must hold):
 *   - blog_status === SCHEDULED
 *   - publish_date <= now
 *   - generation_status === 'generated' (never publish failed/in-flight/draft
 *     content automatically — that is exactly what a human review gate is for)
 *   - has content_blocks and rendered blog_content (belt-and-braces; the wizard
 *     should never produce a scheduled row without content, but a cron job
 *     flipping a blank post live unattended is the one mistake this function
 *     must not make)
 *
 * A row that reaches SCHEDULED but fails one of the content checks is left
 * alone and logged — it is surfaced, not silently skipped, so an operator can
 * see why a post did not go out.
 *
 * @returns {Promise<{published: number, skipped: number, blog_ids: number[]}>}
 */
async function publishScheduledBlogs() {
  const { Op } = require('sequelize');
  const { Blog } = require('../models');

  const due = await Blog.findAll({
    where: {
      blog_status: BLOG_STATUS.SCHEDULED,
      publish_date: { [Op.lte]: new Date() },
    },
  });

  const publishedIds = [];
  let skipped = 0;

  for (const blog of due) {
    if (blog.generation_status !== GENERATION_STATUS.GENERATED) {
      skipped += 1;
      logger.warn(
        `Scheduled blog ${blog.id} ("${blog.blog_title}") is due but generation_status is ` +
          `"${blog.generation_status}" — skipping until it reaches "generated".`
      );
      activity.publishSkipped({
        blogId: Number(blog.id),
        title: blog.blog_title,
        reason: `generation_status is "${blog.generation_status}", needs "generated".`,
      });
      continue;
    }

    const blocks = blog.content_blocks;
    const hasContent = Array.isArray(blocks) && blocks.length > 0;
    const hasRenderedContent = Boolean(blog.blog_content && blog.blog_content.trim() !== '');
    if (!hasContent || !hasRenderedContent) {
      skipped += 1;
      logger.warn(
        `Scheduled blog ${blog.id} ("${blog.blog_title}") is due but has no publishable content — skipping.`
      );
      activity.publishSkipped({
        blogId: Number(blog.id),
        title: blog.blog_title,
        reason: 'No publishable content (empty content_blocks or blog_content).',
      });
      continue;
    }

    blog.blog_status = BLOG_STATUS.PUBLISHED;
    // publish_date already holds the intended date; the beforeSave hook only
    // sets it when absent, so the original scheduled date is preserved rather
    // than being overwritten with "now".
    await blog.save();
    publishedIds.push(Number(blog.id));
    logger.info(`Published scheduled blog ${blog.id} ("${blog.blog_title}").`);
    activity.scheduledPublish({ blogId: Number(blog.id), title: blog.blog_title });

    // Client publish-API delivery — additive, best-effort, never blocks/
    // reverses the save above, never throws. See the equivalent call and
    // its rationale in blogs.controller.js's `publish` handler, and
    // clientDeliveryService.js's own contract.
    require('./delivery/clientDeliveryService')
      .deliverIfConfigured(blog, { trigger: 'scheduled' })
      .catch((err) => logger.error('Client delivery failed for a scheduled publish.', { blogId: Number(blog.id), message: err.message }));
  }

  if (publishedIds.length > 0 || skipped > 0) {
    logger.info(
      `Scheduled publisher: ${publishedIds.length} published, ${skipped} skipped (not ready).`
    );
  }

  return { published: publishedIds.length, skipped, blog_ids: publishedIds };
}

/**
 * Starts the cron job that calls `publishScheduledBlogs` on an interval.
 *
 * A thin wrapper on purpose: `publishScheduledBlogs` is the testable unit,
 * this function is the process-lifecycle glue. Errors inside a single tick
 * are caught and logged rather than thrown, so one bad tick cannot silently
 * kill all future ticks (node-cron does not restart a task whose callback
 * throws).
 *
 * @returns {import('node-cron').ScheduledTask|null} The scheduled task, or
 *   null if the scheduler is disabled — callers can stop() it on shutdown.
 */
function startScheduledPublisher() {
  const config = require('../config');
  if (!config.scheduler.enabled) {
    logger.info('Scheduled publisher disabled (SCHEDULER_ENABLED=false or NODE_ENV=test).');
    return null;
  }

  const cron = require('node-cron');
  if (!cron.validate(config.scheduler.cronExpression)) {
    logger.error(
      `Invalid SCHEDULER_CRON expression "${config.scheduler.cronExpression}" — scheduled publisher not started.`
    );
    return null;
  }

  const task = cron.schedule(
    config.scheduler.cronExpression,
    async () => {
      try {
        await publishScheduledBlogs();
      } catch (err) {
        logger.error('Scheduled publisher tick failed.', err);
      }
    },
    { timezone: config.scheduler.timezone }
  );

  logger.info(
    `Scheduled publisher started (cron "${config.scheduler.cronExpression}", ${config.scheduler.timezone}).`
  );

  return task;
}

module.exports = {
  publishScheduledBlogs,
  startScheduledPublisher,
};
