'use strict';

/**
 * /api/v1/gsc — Google Search Console (feature-flagged), mirroring /serp's
 * shape: stays mounted even when disabled and answers 503 FEATURE_DISABLED
 * from the service layer, so a 404 never has to double as "not configured."
 *
 * `generationLimiter` applies for the same reason as /serp/check-rank: a real
 * Search Console API call, metered the same way a generation is.
 */

const express = require('express');

const { requireAuth } = require('../../middleware/auth');
const { generationLimiter } = require('../../middleware/rateLimit');
const { validate } = require('../../middleware/validate');
const controller = require('../../controllers/gsc.controller');
const { syncBody } = require('../../validators/gsc.validators');

const router = express.Router();

router.post('/sync', requireAuth, generationLimiter, validate({ body: syncBody }), controller.sync);

module.exports = router;
