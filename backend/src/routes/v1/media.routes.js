'use strict';

/**
 * /media routes — image upload, AI generation, and logo compositing.
 *
 * Middleware order is load-bearing on the two multipart routes and is the same
 * every time:
 *
 *   requireAuth          who is this
 *   [generationLimiter]  is this call allowed to spend money
 *   imageUpload.single   parse the multipart body, bounded by MAX_UPLOAD_BYTES
 *   requireImageFile     are these bytes actually an image
 *   validate             are the accompanying fields valid
 *   handler
 *
 * `validate` has to run AFTER Multer: text fields do not exist on `req.body`
 * until the multipart body has been parsed. Running it first would validate an
 * empty object and let every field through unchecked.
 *
 * `requireImageFile` runs before `validate` so a hostile file is rejected on its
 * bytes before we spend any time on its metadata.
 */

const express = require('express');

const { requireAuth } = require('../../middleware/auth');
const { generationLimiter } = require('../../middleware/rateLimit');
const { validate } = require('../../middleware/validate');
const { imageUpload, requireImageFile } = require('../../middleware/upload');
const {
  uploadImageBody,
  generateImageBody,
  compositeLogoBody,
} = require('../../validators/media.validators');
const {
  uploadImage,
  generateImage,
  compositeLogoOnImage,
} = require('../../controllers/media.controller');

const router = express.Router();

// Nothing in this group is public: uploads write to disk and generation spends
// money, so the whole router sits behind authentication.
router.use(requireAuth);

/**
 * POST /media/upload
 * Multipart. Field `image` plus optional logo_overlay / logo_position /
 * size_ratio / opacity / alt_text.
 */
router.post(
  '/upload',
  imageUpload.single('image'),
  requireImageFile(),
  validate({ body: uploadImageBody }),
  uploadImage
);

/**
 * POST /media/generate-image
 * JSON. Rate-limited: every call is a paid provider request.
 */
router.post(
  '/generate-image',
  generationLimiter,
  validate({ body: generateImageBody }),
  generateImage
);

/**
 * POST /media/composite-logo
 * JSON with `relative_path`, or multipart with an `image` file.
 *
 * Not rate-limited by `generationLimiter`: this is pure local CPU work, and it is
 * the cheap way to fix a logo position after generation. Charging it against the
 * generation budget would push users back towards regenerating instead.
 *
 * `requireImageFile({ required: false })` because a JSON request legitimately has
 * no file; the controller enforces "exactly one source".
 */
router.post(
  '/composite-logo',
  imageUpload.single('image'),
  requireImageFile({ required: false }),
  validate({ body: compositeLogoBody }),
  compositeLogoOnImage
);

module.exports = router;
