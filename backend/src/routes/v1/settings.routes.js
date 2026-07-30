'use strict';

const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const controller = require('../../controllers/settings.controller');

const router = express.Router();

router.get('/topics', requireAuth, controller.getTopics);
router.post('/topics', requireAuth, controller.addTopic);
router.delete('/topics/:id', requireAuth, controller.deleteTopic);

module.exports = router;
