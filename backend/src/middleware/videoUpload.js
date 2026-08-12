'use strict';

/**
 * Multipart video upload handling for the Knowledge & Learning Layer's
 * "teach this agent" video-clip source — mirrors middleware/upload.js's
 * two-layer pattern (a cheap Multer mimetype pre-filter, then a real content
 * check) at a much smaller scale, since the only consumer of the bytes is
 * services/agents/knowledge/knowledgeIngestion.js's `transcribeVideoBuffer`
 * (OpenAI Whisper) — the audio track only, never decoded as video here.
 *
 * No video-processing dependency is installed (no ffmpeg, no video decode
 * library), so the content check is a lightweight container-signature probe,
 * not a full decode — enough to reject an arbitrary blob renamed to `.mp4`,
 * not a guarantee the file is playable.
 *
 * Capped at Whisper's own 25MB file-size ceiling — there is no point
 * accepting more than the one thing that will ever consume this buffer can use.
 */

const multer = require('multer');

const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const ALLOWED_MIME_TYPES = Object.freeze(['video/mp4', 'video/webm', 'video/quicktime']);
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

/**
 * mp4/mov share the ISO base media file format: an `ftyp` box named at byte
 * offset 4. WebM is Matroska/EBML, identified by its fixed 4-byte header.
 */
function looksLikeVideo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  const ftyp = buffer.slice(4, 8).toString('ascii');
  const isEbml = buffer.slice(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return ftyp === 'ftyp' || isEbml;
}

const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES, files: 1 },
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIME_TYPES.includes(String(file.mimetype).toLowerCase())) {
      cb(
        new ApiError(415, `Unsupported video type "${file.mimetype}". Allowed: mp4, webm, mov.`, {
          code: 'UPLOAD_MIME_UNSUPPORTED',
        })
      );
      return;
    }
    cb(null, true);
  },
});

/**
 * Mount directly after `videoUpload.single('video')`. On success sets
 * `req.videoFile = { buffer, mimetype, bytes }`. A request with no file
 * passes through untouched (the video source is always optional — a "teach"
 * submission might only include text/links/images).
 *
 * @returns {import('express').RequestHandler}
 */
function requireVideoFile({ required = false } = {}) {
  return asyncHandler(async (req, res, next) => {
    const file = req.file;
    if (!file || !file.buffer || file.buffer.length === 0) {
      if (!required) return next();
      throw ApiError.badRequest('A video file is required in the "video" field.', {
        code: 'UPLOAD_FILE_MISSING',
      });
    }

    if (!looksLikeVideo(file.buffer)) {
      throw new ApiError(415, 'The uploaded file does not look like a supported video container.', {
        code: 'UPLOAD_CONTENT_NOT_VIDEO',
      });
    }

    req.videoFile = {
      buffer: file.buffer,
      mimetype: file.mimetype,
      bytes: file.buffer.length,
    };
    return next();
  });
}

module.exports = {
  videoUpload,
  requireVideoFile,
  looksLikeVideo,
  ALLOWED_MIME_TYPES,
  MAX_VIDEO_BYTES,
};
