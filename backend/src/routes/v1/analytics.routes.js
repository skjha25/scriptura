'use strict';

/**
 * /api/v1/analytics
 *
 * Read-only dashboard aggregates. Authenticated but not role-restricted: every
 * team member sees the same dashboard.
 */

const express = require('express');

const { validate } = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const { overviewQuerySchema } = require('../../validators/analytics.validators');
const controller = require('../../controllers/analytics.controller');

const router = express.Router();

router.use(requireAuth);

router.get('/overview', validate({ query: overviewQuerySchema }), controller.overview);
router.get('/in-flight', controller.inFlight);

module.exports = router;
