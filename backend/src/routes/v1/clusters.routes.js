'use strict';

const express = require('express');
const controller = require('../../controllers/clusters.controller');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const {
  createClusterBody,
  updateClusterBody,
  listClustersQuery,
  expandClusterBody,
  checkCannibalizationBody,
  checkTimeSlotQuery,
  scheduleAllBody,
  autoScheduleBody,
  idParam,
  keywordParam,
  updateKeywordBody,
} = require('../../validators/cluster.validators');

const router = express.Router();

router.use(requireAuth);

router.get('/', validate({ query: listClustersQuery }), controller.list);
router.post('/', validate({ body: createClusterBody }), controller.create);

// Non-parametric routes sit above /:id so they don't match as an id.
router.post('/check-cannibalization', validate({ body: checkCannibalizationBody }), controller.cannibalization);
router.get('/check-time-slot', validate({ query: checkTimeSlotQuery }), controller.checkTimeSlot);

router.get('/:id', validate({ params: idParam }), controller.show);
router.patch('/:id', validate({ params: idParam, body: updateClusterBody }), controller.update);
router.delete('/:id', validate({ params: idParam }), controller.remove);

router.post('/:id/expand', validate({ params: idParam, body: expandClusterBody }), controller.expand);
router.post('/:id/schedule-all', validate({ params: idParam, body: scheduleAllBody }), controller.scheduleAll);
router.post('/:id/auto-schedule', validate({ params: idParam, body: autoScheduleBody }), controller.autoSchedule);

router.patch('/:id/keywords/:keywordId', validate({ params: keywordParam, body: updateKeywordBody }), controller.updateKeyword);
router.delete('/:id/keywords/:keywordId', validate({ params: keywordParam }), controller.removeKeyword);

module.exports = router;
