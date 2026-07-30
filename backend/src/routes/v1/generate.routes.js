'use strict';

/**
 * /api/v1/generate — AI text generation.
 *
 * Every route here spends money at a provider, so every route gets
 * `generationLimiter` (the tightest of the three tiers, keyed per user) as well
 * as `requireAuth`. The one exception is the status poll: it is a single indexed
 * read that the wizard calls every couple of seconds while a run is in flight, so
 * rate-limiting it would break the very flow it reports on.
 *
 * Middleware order is load-bearing: authenticate, then rate-limit (so the limiter
 * can key on `req.user.id` rather than a shared office IP), then validate.
 */

const express = require('express');

const { requireAuth, requireAdmin } = require('../../middleware/auth');
const { generationLimiter } = require('../../middleware/rateLimit');
const { validate } = require('../../middleware/validate');
const controller = require('../../controllers/generation.controller');
const {
  generateTitleBody,
  generateOutlineBody,
  generateArticleBody,
  generationStatusParams,
} = require('../../validators/generation.validators');

const router = express.Router();

router.post(
  '/title',
  requireAuth,
  generationLimiter,
  validate({ body: generateTitleBody }),
  controller.generateTitle
);

router.post(
  '/outline',
  requireAuth,
  generationLimiter,
  validate({ body: generateOutlineBody }),
  controller.generateOutline
);

router.post(
  '/article',
  requireAuth,
  generationLimiter,
  validate({ body: generateArticleBody }),
  controller.generateArticle
);

router.get(
  '/status/:blogId',
  requireAuth,
  validate({ params: generationStatusParams }),
  controller.getStatus
);

router.post(
  '/auto-topic',
  requireAuth,
  generationLimiter,
  controller.generateAutoTopic
);

/**
 * Admin-only: unstick rows abandoned in `generating` by a restart.
 *
 * Restricted because it rewrites generation state across the table, and because
 * an editor who does not know why a blog is stuck should ask rather than reap.
 */
router.post('/reap-stale', requireAuth, requireAdmin, controller.reapStale);

module.exports = router;
