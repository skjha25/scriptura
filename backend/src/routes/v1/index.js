'use strict';

/**
 * API v1 router.
 *
 * Mounted by src/app.js at config.apiPrefix ('/api/v1') behind the global rate
 * limiter. Each route group owns its own file and applies its own
 * authentication; there is no blanket requireAuth here, because /auth/login and
 * /auth/refresh must stay reachable while unauthenticated.
 *
 * Route groups:
 *   /auth         sign in, refresh, sign out
 *   /blogs        CRUD, publish, generation-status polling, internal-link search
 *   /generate     title / outline / article generation (Claude)
 *   /brand-voice  tone analysis from pasted text, a scraped URL, or a file
 *   /media        uploads, AI image generation, logo compositing
 *   /serp         rank checking and fact grounding (feature-flagged)
 *   /analytics    dashboard aggregates
 */

const express = require('express');

const authRoutes = require('./auth.routes');
const blogRoutes = require('./blogs.routes');
const generateRoutes = require('./generate.routes');
const brandVoiceRoutes = require('./brandVoice.routes');
const mediaRoutes = require('./media.routes');
const serpRoutes = require('./serp.routes');
const analyticsRoutes = require('./analytics.routes');

const router = express.Router();

/**
 * Cheap, unauthenticated capability probe.
 *
 * The frontend calls this on boot to decide whether to render SERP-dependent
 * controls at all, rather than offering a toggle that would fail on use.
 */
router.get('/meta', (req, res) => {
  const config = require('../../config');
  const {
    BLOG_STATUS,
    BLOG_STATUS_LABELS,
    GENERATION_STATUS,
    ARTICLE_TYPES,
    READABILITY_LEVELS,
    BRAND_VOICE_SOURCE_TYPES,
    IMAGE_STYLES,
    LOGO_POSITIONS,
    BLOCK_TYPES,
    POINTS_OF_VIEW,
    DEFAULT_SEO_STRUCTURE,
    IMAGE_COUNT_MIN,
    IMAGE_COUNT_MAX,
  } = require('../../constants');

  res.json({
    features: {
      serp_api: config.serp.enabled,
      text_provider: config.ai.textProvider,
      image_provider: config.ai.imageProvider,
      storage_driver: config.storage.driver,
    },
    enums: {
      blog_status: BLOG_STATUS,
      blog_status_labels: BLOG_STATUS_LABELS,
      generation_status: GENERATION_STATUS,
      article_types: ARTICLE_TYPES,
      readability_levels: READABILITY_LEVELS,
      brand_voice_source_types: BRAND_VOICE_SOURCE_TYPES,
      image_styles: IMAGE_STYLES,
      logo_positions: LOGO_POSITIONS,
      block_types: BLOCK_TYPES,
      points_of_view: POINTS_OF_VIEW,
    },
    defaults: {
      seo_structure: DEFAULT_SEO_STRUCTURE,
      image_count_min: IMAGE_COUNT_MIN,
      image_count_max: IMAGE_COUNT_MAX,
    },
  });
});

router.use('/auth', authRoutes);
router.use('/blogs', blogRoutes);
router.use('/generate', generateRoutes);
router.use('/brand-voice', brandVoiceRoutes);
router.use('/media', mediaRoutes);
router.use('/serp', serpRoutes);
router.use('/analytics', analyticsRoutes);

module.exports = router;
