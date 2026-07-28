'use strict';

/**
 * Multipart image upload handling.
 *
 * Two layers, because a client-declared `Content-Type` is a hint, not evidence:
 *
 *   1. `imageUpload` — Multer, memory storage, bounded by
 *      `config.storage.maxUploadBytes`. Its `fileFilter` rejects an obviously
 *      wrong declared mimetype early, which is worth doing only because it saves
 *      buffering the body; it proves nothing about the content.
 *
 *   2. `requireImageFile` — the real check. It inspects the leading bytes for a
 *      PNG/JPEG/WebP signature and then makes sharp decode the header. A `.exe`
 *      posted as `image/png`, an SVG containing script, or a polyglot file all
 *      fail here, before anything reaches storage. Only after this does
 *      `req.imageFile` exist, and controllers use nothing else.
 *
 * Memory storage rather than disk: every uploaded image is immediately re-encoded
 * by sharp (EXIF stripped, logo composited) before being stored under its
 * generated path, so a temp file on disk would only be a second copy to clean up
 * — and an unvalidated file sitting in a writable directory, however briefly, is
 * exactly the thing to avoid.
 *
 * There is no document/docx uploader here on purpose: brand-voice file upload has
 * a different threat model (text extraction, not re-encoding) and owns its own
 * Multer instance in its route file.
 */

const multer = require('multer');
const sharp = require('sharp');

const config = require('../config');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

/** Declared mimetypes the filter will let through to the content check. */
const ALLOWED_MIME_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

/** sharp format names we accept once the bytes have been decoded. */
const ALLOWED_FORMATS = Object.freeze(['png', 'jpeg', 'webp']);

/** Canonical extension per decoded format, for the generated storage path. */
const FORMAT_EXTENSIONS = Object.freeze({ png: 'png', jpeg: 'jpg', webp: 'webp' });

/** Canonical Content-Type per decoded format. */
const FORMAT_CONTENT_TYPES = Object.freeze({
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
});

/**
 * Largest pixel count we will decode. libvips allocates in proportion to
 * dimensions, not file size, so a 20KB "decompression bomb" PNG declaring
 * 50000x50000 would otherwise try to allocate ~10GB. 50MP is far above any
 * realistic blog image.
 */
const MAX_PIXELS = 50 * 1000 * 1000;

/**
 * Magic-byte signatures. Checked before sharp so a hostile file is rejected on a
 * few bytes rather than by handing it to a native decoder.
 *
 * WebP is a RIFF container: bytes 0–3 are `RIFF`, 8–11 are `WEBP`, and bytes 4–7
 * are a length we do not care about — hence the offset pairs rather than one
 * contiguous prefix.
 */
const SIGNATURES = Object.freeze([
  { format: 'png', parts: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }] },
  { format: 'jpeg', parts: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },
  {
    format: 'webp',
    parts: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
    ],
  },
]);

/**
 * Identifies an image by its leading bytes, ignoring any declared mimetype.
 *
 * @param {Buffer} buffer
 * @returns {'png'|'jpeg'|'webp'|null} null when no signature matches.
 */
function detectImageFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  for (const signature of SIGNATURES) {
    const matches = signature.parts.every((part) =>
      part.bytes.every((byte, i) => buffer[part.offset + i] === byte)
    );
    if (matches) return signature.format;
  }
  return null;
}

/**
 * Builds a Multer instance for image uploads.
 *
 * Exported as a factory as well as a default instance so a route with a different
 * budget (or a test asserting the limit) can construct its own without reaching
 * into module state.
 *
 * @param {object} [options]
 * @param {number} [options.maxBytes] Defaults to `config.storage.maxUploadBytes`.
 * @param {number} [options.maxFiles] Defaults to 1.
 * @returns {import('multer').Multer}
 */
function createImageUpload({ maxBytes, maxFiles = 1 } = {}) {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxBytes || config.storage.maxUploadBytes,
      files: maxFiles,
      // Text fields carry the logo options; a generous but finite cap stops a
      // multipart body from being used as an unbounded field dump.
      fields: 20,
      fieldSize: 8 * 1024,
    },
    fileFilter(req, file, cb) {
      // A cheap pre-filter only. `requireImageFile` is what actually decides.
      if (!ALLOWED_MIME_TYPES.includes(String(file.mimetype).toLowerCase())) {
        cb(
          new ApiError(415, `Unsupported image type "${file.mimetype}". Allowed: PNG, JPEG, WebP.`, {
            code: 'UPLOAD_MIME_UNSUPPORTED',
          })
        );
        return;
      }
      cb(null, true);
    },
  });
}

/** The shared instance mounted by src/routes/v1/media.routes.js. */
const imageUpload = createImageUpload();

/**
 * Verifies that the uploaded bytes really are an image, and normalises what the
 * controller sees.
 *
 * Mount directly after `imageUpload.single(field)`. On success sets:
 *
 *   req.imageFile = { buffer, format, ext, contentType, width, height, bytes,
 *                     originalName, declaredMimeType }
 *
 * @param {object} [options]
 * @param {boolean} [options.required] When false, a request with no file passes
 *   through with `req.imageFile` unset — used by /media/composite-logo, which
 *   accepts either an upload or an already-stored path.
 * @returns {import('express').RequestHandler}
 */
function requireImageFile({ required = true } = {}) {
  return asyncHandler(async (req, res, next) => {
    const file = req.file;

    if (!file || !file.buffer || file.buffer.length === 0) {
      if (!required) return next();
      throw ApiError.badRequest('An image file is required in the "image" field.', {
        code: 'UPLOAD_FILE_MISSING',
      });
    }

    const detected = detectImageFormat(file.buffer);
    if (!detected) {
      // The interesting case: declared image/png, actually something else.
      throw new ApiError(
        415,
        'The uploaded file is not a PNG, JPEG or WebP image. ' +
          'Its contents do not match any supported image format, regardless of the ' +
          'declared content type.',
        {
          code: 'UPLOAD_CONTENT_NOT_IMAGE',
          details: { declaredMimeType: file.mimetype },
        }
      );
    }

    // Second opinion from the decoder: a valid signature followed by corrupt data
    // still cannot be processed, and finding that out here yields a 415 instead
    // of a 500 from deep inside the composite pipeline.
    let meta;
    try {
      meta = await sharp(file.buffer, { limitInputPixels: MAX_PIXELS }).metadata();
    } catch (err) {
      throw new ApiError(415, 'The uploaded image could not be decoded — it may be corrupt.', {
        code: 'UPLOAD_IMAGE_CORRUPT',
        cause: err,
      });
    }

    if (!ALLOWED_FORMATS.includes(meta.format)) {
      throw new ApiError(415, `Unsupported image format "${meta.format}". Allowed: PNG, JPEG, WebP.`, {
        code: 'UPLOAD_FORMAT_UNSUPPORTED',
      });
    }
    if (!meta.width || !meta.height) {
      throw new ApiError(415, 'The uploaded image has no readable dimensions.', {
        code: 'UPLOAD_IMAGE_CORRUPT',
      });
    }
    if (meta.width * meta.height > MAX_PIXELS) {
      throw new ApiError(
        413,
        `The image is too large to process (${meta.width}x${meta.height}). ` +
          `The limit is ${MAX_PIXELS / 1e6} megapixels.`,
        { code: 'UPLOAD_IMAGE_TOO_MANY_PIXELS' }
      );
    }

    req.imageFile = {
      buffer: file.buffer,
      format: meta.format,
      ext: FORMAT_EXTENSIONS[meta.format],
      contentType: FORMAT_CONTENT_TYPES[meta.format],
      width: meta.width,
      height: meta.height,
      bytes: file.buffer.length,
      originalName: file.originalname,
      declaredMimeType: file.mimetype,
    };

    return next();
  });
}

module.exports = {
  imageUpload,
  createImageUpload,
  requireImageFile,
  detectImageFormat,
  ALLOWED_MIME_TYPES,
  ALLOWED_FORMATS,
  FORMAT_EXTENSIONS,
  FORMAT_CONTENT_TYPES,
  MAX_PIXELS,
};
