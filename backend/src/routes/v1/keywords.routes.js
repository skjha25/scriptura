'use strict';

const express = require('express');
const controller = require('../../controllers/keywords.controller');
const { requireAuth } = require('../../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/', controller.list);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);
router.post('/bulk-import', controller.bulkImport);
router.get('/suggest', controller.suggest);

module.exports = router;
