'use strict';

/**
 * /api/v1/config — client publish-API integrations (the Config page).
 *
 * No feature flag/503 pattern here (unlike /serp, /gsc) — this isn't an
 * optional external provider integration, it's admin-managed data that
 * either has rows or doesn't; an empty list is a normal, valid response.
 */

const express = require('express');

const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const controller = require('../../controllers/publishingIntegration.controller');
const {
  createIntegrationBody,
  updateIntegrationBody,
  replaceFieldMappingsBody,
  testConnectionBody,
  listDeliveryLogsQuery,
} = require('../../validators/publishingIntegration.validators');

const router = express.Router();

router.get('/available-fields', requireAuth, controller.getAvailableFields);

router.get('/integrations', requireAuth, controller.listIntegrations);
router.post('/integrations', requireAuth, validate({ body: createIntegrationBody }), controller.createIntegration);
router.get('/integrations/:id', requireAuth, controller.getIntegration);
router.patch('/integrations/:id', requireAuth, validate({ body: updateIntegrationBody }), controller.updateIntegration);

router.put(
  '/integrations/:id/field-mappings',
  requireAuth,
  validate({ body: replaceFieldMappingsBody }),
  controller.replaceFieldMappings
);

router.post(
  '/integrations/:id/test-connection',
  requireAuth,
  validate({ body: testConnectionBody }),
  controller.testConnection
);

router.get(
  '/integrations/:id/delivery-logs',
  requireAuth,
  validate({ query: listDeliveryLogsQuery }),
  controller.listDeliveryLogs
);

router.post('/delivery-logs/:logId/retry', requireAuth, controller.retryDeliveryLog);

module.exports = router;
