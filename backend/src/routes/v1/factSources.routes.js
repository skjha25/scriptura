'use strict';

/**
 * /api/v1/settings/fact-sources — P6-B Fact Verification source management.
 *
 * Multer is configured here, not in shared middleware, for the same reason
 * brandVoice.routes.js keeps its own instance: this upload has its own
 * policy (bigger limit than a writing sample, three extensions instead of
 * two) and sharing an instance would force one set of limits onto both.
 */

const express = require('express');
const path = require('path');
const multer = require('multer');

const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const ApiError = require('../../utils/ApiError');
const controller = require('../../controllers/factSources.controller');
const { addFactSourceBody, updateFactSourceBody, factSourceIdParams, factVerificationPolicyBody } = require('../../validators/factSources.validators');
const { FACT_SOURCE_UPLOAD_EXTENSIONS } = require('../../constants');

/** A reference document is prose, not media — 10MB comfortably covers a real PDF/docx without inviting abuse. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIMETYPES = Object.freeze([
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/pdf',
  'application/octet-stream',
  'application/zip',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10, parts: 12 },
  fileFilter(req, file, callback) {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const extensionOk = FACT_SOURCE_UPLOAD_EXTENSIONS.includes(extension);
    const mimetypeOk = ALLOWED_MIMETYPES.includes(String(file.mimetype || '').toLowerCase());
    if (extensionOk && mimetypeOk) return callback(null, true);
    return callback(
      ApiError.unprocessable(
        `Only ${FACT_SOURCE_UPLOAD_EXTENSIONS.join(', ')} files can be added as a fact source. Received "${file.originalname}" (${file.mimetype}).`,
        { code: 'UNSUPPORTED_FILE_TYPE', details: { extension, mimetype: file.mimetype, allowed: FACT_SOURCE_UPLOAD_EXTENSIONS } }
      )
    );
  },
});

const router = express.Router();

router.get('/', requireAuth, controller.listFactSources);
router.post('/', requireAuth, validate({ body: addFactSourceBody }), controller.addFactSource);
router.post('/upload', requireAuth, upload.single('file'), controller.uploadFactSource);
router.put('/:id', requireAuth, validate({ params: factSourceIdParams, body: updateFactSourceBody }), controller.updateFactSource);
router.delete('/:id', requireAuth, validate({ params: factSourceIdParams }), controller.removeFactSource);

// Mounted as its own sibling route so it reads as "the policy", not "a source".
const policyRouter = express.Router();
policyRouter.put('/', requireAuth, validate({ body: factVerificationPolicyBody }), controller.updateFactVerificationPolicy);

module.exports = { sourcesRouter: router, policyRouter };
