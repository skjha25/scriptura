'use strict';

/**
 * /api/v1/serp — rank checking and web fact grounding (feature-flagged).
 *
 * Both endpoints stay mounted even when SerpAPI is disabled, and answer 503
 * FEATURE_DISABLED from the service layer. Not mounting them would give a 404,
 * which is indistinguishable from "this version of the API has no SERP support" —
 * a much worse thing for a client to have to guess at. `GET /api/v1/meta` is the
 * cheap check the frontend uses to hide the controls in the first place.
 *
 * `generationLimiter` applies because SerpAPI is metered per search, so these
 * requests cost money in the same way a generation does.
 */

const express = require('express');

const { requireAuth } = require('../../middleware/auth');
const { generationLimiter } = require('../../middleware/rateLimit');
const { validate } = require('../../middleware/validate');
const controller = require('../../controllers/serp.controller');
const { checkRankBody, groundFactsBody } = require('../../validators/serp.validators');

const router = express.Router();

router.post(
  '/check-rank',
  requireAuth,
  generationLimiter,
  validate({ body: checkRankBody }),
  controller.checkRank
);

router.post(
  '/ground-facts',
  requireAuth,
  generationLimiter,
  validate({ body: groundFactsBody }),
  controller.groundFacts
);

module.exports = router;
