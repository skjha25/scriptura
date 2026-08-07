'use strict';

/**
 * Autopilot generation scheduler.
 *
 * A node-cron job that checks every minute for cluster keywords whose
 * `scheduled_generation_date` has arrived and triggers blog generation
 * automatically — no human click required.
 *
 * Design principles (consistent with scheduledPublisher.js):
 *   - Runs in-process, single-instance (no Redis/queue)
 *   - Processes one keyword per tick to avoid API rate limits
 *   - Errors inside a tick are caught; one bad tick cannot kill future ticks
 *   - The generation itself is fire-and-forget (like manual startGeneration)
 *   - Keywords that fail get retried up to MAX_RETRIES before being skipped
 *
 * The flow for each keyword:
 *   1. Find the next due keyword (status=pending, gen_date <= now, cluster active)
 *   2. Mark it 'generating'
 *   3. AI generates topic + title (via generateAutoTopic-like logic)
 *   4. Create a blog row (DRAFT or SCHEDULED based on suggested_publish_date)
 *   5. Start full article generation
 *   6. Link the blog back to the keyword
 *   7. On completion, mark keyword as 'generated'
 */

const logger = require('../utils/logger');
const activity = require('./activityLogger');
const { CLUSTER_STATUS, CLUSTER_KEYWORD_STATUS, BLOG_STATUS, GENERATION_STATUS } = require('../constants');

const MAX_RETRIES = 3;

/**
 * Finds the next due keyword and triggers generation.
 *
 * @returns {Promise<{processed: boolean, keyword_id?: number, blog_id?: number, error?: string}>}
 */
async function processNextDueKeyword() {
  const { Op } = require('sequelize');
  const { ClusterKeyword, Blog } = require('../models');
  const { startGeneration } = require('./generation');
  const { getTextProvider } = require('./ai');
  const serp = require('./serp');
  const { sanitizeInline, toPlainText } = require('./sanitize');
  const { scoreTitle } = require('./seoScore');

  // -------------------------------------------------------------------------
  // 1. Find the next keyword whose scheduled time has arrived
  // -------------------------------------------------------------------------
  const now = new Date();
  const keyword = await ClusterKeyword.findOne({
    where: {
      status: CLUSTER_KEYWORD_STATUS.PENDING,
      scheduled_generation_date: { [Op.lte]: now, [Op.ne]: null },
    },
    include: [{
      association: 'cluster',
      where: { status: CLUSTER_STATUS.ACTIVE },
      required: true,
    }],
    order: [['scheduled_generation_date', 'ASC']],
  });

  if (!keyword) {
    return { processed: false };
  }

  const cluster = keyword.cluster;
  const primaryKeyword = keyword.keyword;

  logger.info(`Autopilot: processing keyword "${primaryKeyword}" (id: ${keyword.id}, cluster: ${cluster.name})`);

  await activity.autopilotTriggered({
    clusterId: cluster.id,
    keywordId: keyword.id,
    keyword: primaryKeyword,
    scheduledDate: keyword.scheduled_generation_date,
  });

  // -------------------------------------------------------------------------
  // 2. Mark as generating
  // -------------------------------------------------------------------------
  keyword.status = CLUSTER_KEYWORD_STATUS.GENERATING;
  await keyword.save();

  try {
    // -----------------------------------------------------------------------
    // 3. AI topic + title generation
    // -----------------------------------------------------------------------
    const textProvider = getTextProvider();

    let serpData = null;
    if (serp.isEnabled()) {
      try {
        serpData = await serp.fetchSerpDataForKeyword(primaryKeyword);
      } catch (err) {
        logger.warn('Autopilot: SERP fetch failed, continuing without grounding.', { error: err.message });
      }
    }

    const { titles, topic, suggested_secondary_keywords } =
      await textProvider.generateAutoTopicFromKeyword({
        keyword: primaryKeyword,
        secondaryKeywords: [],
        serpData,
      });

    // Pick the highest-scoring title
    const scoredTitles = titles.map((entry) => {
      const safe = sanitizeInline(entry.title) || entry.title;
      const plain = toPlainText(safe) || safe;
      return {
        title: plain,
        seo: scoreTitle(plain, { keyword: primaryKeyword }),
      };
    });

    scoredTitles.sort((a, b) => (b.seo?.score || 0) - (a.seo?.score || 0));
    const bestTitle = scoredTitles[0]?.title || `${primaryKeyword} — Complete Guide`;

    // -----------------------------------------------------------------------
    // 4. Create blog row
    // -----------------------------------------------------------------------
    const blogData = {
      blog_title: bestTitle,
      topic: topic || primaryKeyword,
      seo_keywords: primaryKeyword,
      secondary_keywords: suggested_secondary_keywords || [],
      blog_status: keyword.suggested_publish_date
        ? BLOG_STATUS.SCHEDULED
        : BLOG_STATUS.DRAFT,
      publish_date: keyword.suggested_publish_date || null,
      generation_status: GENERATION_STATUS.DRAFT,
      cluster_id: Number(cluster.id),
      article_type: 'general',
      language: 'en',
      target_country: 'India',
      readability_level: '8th_grade',
      include_images: true,
      image_count: 2,
      image_style: 'illustration',
      logo_overlay: true,
      logo_position: 'top_right',
      internal_linking: true,
      external_web_grounding: serp.isEnabled(),
      ai_content_cleaning: true,
      optimization_profile: 'balanced',
      seo_structure_config: {
        h1: true, h2: true, h3: true,
        faq: true, tables: false,
        key_takeaways: true, quotes: false,
        lists: true, emphasis: true,
      },
    };

    const blog = await Blog.create(blogData);

    // Link keyword to blog
    keyword.assigned_blog_id = blog.id;
    await keyword.save();

    logger.info(`Autopilot: created blog #${blog.id} ("${bestTitle}") for keyword "${primaryKeyword}"`);

    await activity.autopilotBlogCreated({
      blogId: blog.id,
      clusterId: cluster.id,
      keywordId: keyword.id,
      keyword: primaryKeyword,
      title: bestTitle,
    });

    // -----------------------------------------------------------------------
    // 5. Trigger full article generation (fire-and-forget)
    // -----------------------------------------------------------------------
    const generationConfig = {
      topic: topic || primaryKeyword,
      title: bestTitle,
      keyword: primaryKeyword,
      secondary_keywords: suggested_secondary_keywords || [],
      article_type: 'general',
      target_word_count: 2000,
      language: 'en',
      target_country: 'India',
      readability_level: '8th_grade',
      tone_of_voice: 'informative',
      include_images: true,
      image_count: 2,
      image_style: 'illustration',
      logo_overlay: true,
      logo_position: 'top_right',
      internal_linking: true,
      external_web_grounding: serp.isEnabled(),
      ai_content_cleaning: true,
      optimization_profile: 'balanced',
      seo_structure_config: {
        h1: true, h2: true, h3: true,
        faq: true, tables: false,
        key_takeaways: true, quotes: false,
        lists: true, emphasis: true,
      },
      brand_voice: { source_type: 'none' },
    };

    // startGeneration is async — it claims the row and fires the run.
    // We do NOT await the full generation; it proceeds in the background.
    const result = await startGeneration({
      blogId: blog.id,
      config: generationConfig,
      user: null, // Autopilot, no user
    });

    logger.info(`Autopilot: generation queued for blog #${blog.id}`, result);

    // Mark keyword as scheduled (generation in progress, will become
    // 'generated' once the async generation completes — tracked separately)
    keyword.status = CLUSTER_KEYWORD_STATUS.SCHEDULED;
    await keyword.save();

    return { processed: true, keyword_id: Number(keyword.id), blog_id: Number(blog.id) };
  } catch (err) {
    // -----------------------------------------------------------------------
    // 6. Error handling with retry logic
    // -----------------------------------------------------------------------
    logger.error(`Autopilot: failed to process keyword "${primaryKeyword}"`, err);

    const retryCount = (keyword.metadata?.retry_count || 0) + 1;

    if (retryCount >= MAX_RETRIES) {
      // Exhausted retries — skip this keyword
      logger.warn(`Autopilot: keyword "${primaryKeyword}" failed ${MAX_RETRIES} times, marking for manual intervention.`);
      keyword.status = CLUSTER_KEYWORD_STATUS.PENDING;
      // Remove the scheduled date so autopilot stops retrying
      keyword.scheduled_generation_date = null;
      await keyword.save();

      await activity.autopilotSkipped({
        clusterId: cluster.id,
        keywordId: keyword.id,
        keyword: primaryKeyword,
        reason: `Failed ${MAX_RETRIES} times — requires manual intervention.`,
        metadata: { error: err.message, retry_count: retryCount },
      });
    } else {
      // Put back to pending for retry on next tick
      keyword.status = CLUSTER_KEYWORD_STATUS.PENDING;
      await keyword.save();

      await activity.autopilotRetry({
        clusterId: cluster.id,
        keywordId: keyword.id,
        keyword: primaryKeyword,
        retryCount,
        maxRetries: MAX_RETRIES,
        metadata: { error: err.message },
      });
    }

    return { processed: true, keyword_id: Number(keyword.id), error: err.message };
  }
}

/**
 * Starts the autopilot cron job.
 *
 * @returns {import('node-cron').ScheduledTask|null}
 */
function startAutopilotScheduler() {
  const config = require('../config');
  if (!config.autopilot.enabled) {
    logger.info('Autopilot scheduler disabled (AUTOPILOT_ENABLED=false or NODE_ENV=test).');
    return null;
  }

  const cron = require('node-cron');
  if (!cron.validate(config.autopilot.cronExpression)) {
    logger.error(
      `Invalid AUTOPILOT_CRON expression "${config.autopilot.cronExpression}" — autopilot not started.`
    );
    return null;
  }

  const task = cron.schedule(
    config.autopilot.cronExpression,
    async () => {
      try {
        await processNextDueKeyword();
      } catch (err) {
        logger.error('Autopilot scheduler tick failed.', err);
      }
    },
    { timezone: config.autopilot.timezone }
  );

  logger.info(
    `Autopilot scheduler started (cron "${config.autopilot.cronExpression}", ${config.autopilot.timezone}).`
  );

  return task;
}

module.exports = {
  processNextDueKeyword,
  startAutopilotScheduler,
};
