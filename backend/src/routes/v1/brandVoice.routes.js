'use strict';

/**
 * /api/v1/brand-voice — tone analysis from text, a URL, or an uploaded file.
 *
 * ---------------------------------------------------------------------------
 * WHY MULTER IS CONFIGURED HERE AND NOT IN SHARED MIDDLEWARE
 * ---------------------------------------------------------------------------
 * The media workstream owns image uploads, which need a completely different
 * policy: bigger limit, image mimetypes, disk or S3 destination. Sharing one
 * instance would force one set of limits onto both, and the looser of the two
 * would win. This one is deliberately narrow — memory storage, 2 MB, exactly two
 * document types — because that is all a writing sample needs.
 *
 * ---------------------------------------------------------------------------
 * WHY MEMORY STORAGE
 * ---------------------------------------------------------------------------
 * The file is read once, converted to text, and discarded. Writing it to disk
 * first would leave a copy of a client's style guide in a temp directory with
 * nothing responsible for deleting it.
 *
 * ---------------------------------------------------------------------------
 * WHY BOTH MIMETYPE AND EXTENSION ARE CHECKED
 * ---------------------------------------------------------------------------
 * Mimetype is client-supplied and trivially spoofed; extension alone lets
 * `report.txt` arrive as a mislabelled binary. Neither is sufficient, both
 * together are cheap, and services/brandVoice.extractFromFile re-checks the
 * extension a third time — because a security check that only exists in
 * middleware is one refactor away from being gone.
 */

const express = require('express');
const path = require('path');
const multer = require('multer');

const { requireAuth } = require('../../middleware/auth');
const { generationLimiter } = require('../../middleware/rateLimit');
const { validate } = require('../../middleware/validate');
const ApiError = require('../../utils/ApiError');
const controller = require('../../controllers/brandVoice.controller');
const { analyzeBrandVoiceBody } = require('../../validators/brandVoice.validators');
const { ALLOWED_FILE_EXTENSIONS } = require('../../services/brandVoice');

/** A style guide is prose. 2 MB is a very long document; anything more is not one. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/**
 * Accepted mimetypes.
 *
 * The list is longer than it looks because browsers disagree: Windows reports
 * .txt as `text/plain` and occasionally `application/octet-stream`, and .docx as
 * the long OOXML type but sometimes `application/zip` (which it structurally is).
 * The extension check is what keeps the loose entries safe.
 */
const ALLOWED_MIMETYPES = Object.freeze([
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/octet-stream',
  'application/zip',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    // Bounds the multipart parser itself, not just the file: a request with
    // thousands of tiny text fields is a cheap way to burn CPU.
    fields: 10,
    parts: 12,
  },
  fileFilter(req, file, callback) {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const extensionOk = ALLOWED_FILE_EXTENSIONS.includes(extension);
    const mimetypeOk = ALLOWED_MIMETYPES.includes(String(file.mimetype || '').toLowerCase());

    if (extensionOk && mimetypeOk) return callback(null, true);

    // A rejection here reaches the error handler as an ApiError, so the client
    // gets the standard envelope rather than Multer's own error shape.
    return callback(
      ApiError.unprocessable(
        `Only ${ALLOWED_FILE_EXTENSIONS.join(' and ')} files can be analysed. ` +
          `Received "${file.originalname}" (${file.mimetype}).`,
        {
          code: 'UNSUPPORTED_FILE_TYPE',
          details: { extension, mimetype: file.mimetype, allowed: ALLOWED_FILE_EXTENSIONS },
        }
      )
    );
  },
});

const router = express.Router();

/**
 * POST /brand-voice/analyze
 *
 * `upload.single('file')` runs before validation on purpose: on a multipart
 * request the text fields do not exist on `req.body` until Multer has parsed the
 * stream, so validating first would reject every upload for a missing
 * `source_type`. On a JSON request it is a no-op passthrough.
 */
router.post(
  '/analyze',
  requireAuth,
  generationLimiter,
  upload.single('file'),
  validate({ body: analyzeBrandVoiceBody }),
  controller.analyze
);

module.exports = router;
