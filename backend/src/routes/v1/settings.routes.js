'use strict';

const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const controller = require('../../controllers/settings.controller');
const { imageDefaultsBody } = require('../../validators/contentSettings.validators');

const router = express.Router();

router.get('/topics', requireAuth, controller.getTopics);
router.get('/topics/suggest', requireAuth, controller.suggestTopics);
router.post('/topics', requireAuth, controller.addTopic);
router.delete('/topics/:id', requireAuth, controller.deleteTopic);

router.get('/autopilot', requireAuth, controller.getAutopilot);
router.put('/autopilot', requireAuth, controller.updateAutopilot);

// P6-A: global content image defaults — see settings.controller.js's own comment.
router.get('/image-defaults', requireAuth, controller.getImageDefaults);
router.put('/image-defaults', requireAuth, validate({ body: imageDefaultsBody }), controller.updateImageDefaults);

module.exports = router;
