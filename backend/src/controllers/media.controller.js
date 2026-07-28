'use strict';

/**
 * /media handlers: upload, AI generation, and logo re-compositing.
 *
 * Every response here reports `relativePath` alongside `publicUrl`. Both are
 * needed and they are not interchangeable: the wizard writes `relativePath` into
 * `blogs.blog_picture` / `extra_images[].url`, and renders `publicUrl` in the
 * preview. Storing the URL instead would bake the current driver into the data —
 * see services/storage for the full argument.
 *
 * The pipeline for an uploaded image is fixed and applies in this order:
 *
 *   validate bytes (middleware/upload)
 *     -> re-encode, apply EXIF orientation, STRIP EXIF (logoComposite)
 *     -> optional logo overlay
 *     -> store under blogs/{Month}{Year}/{random}.{ext}
 *
 * The EXIF strip is not optional and happens before anything is persisted: a
 * photo shot on a phone carries GPS coordinates, and these files are served
 * publicly by the static mount in src/app.js.
 */

const sharp = require('sharp');

const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');
const { escapeHtml, safeUrl } = require('../services/sanitize');
const { compositeLogo, normalizeImage } = require('../services/logoComposite');
const { generateBlogImage, buildAltText } = require('../services/imageGeneration');
const storage = require('../services/storage');
const { FORMAT_EXTENSIONS } = require('../middleware/upload');

/**
 * Cleans a client-supplied alt text.
 *
 * Alt text is rendered into an `alt="..."` attribute by services/blocksToHtml, so
 * it is escaped here, on the way in — the same "sanitise before persisting" rule
 * services/sanitize.js documents. Otherwise a crafted alt text becomes stored XSS
 * for every consumer of the `blogs` table, not just this app.
 *
 * @param {string|undefined} value
 * @param {object} fallbackArgs Passed to buildAltText when no value was supplied.
 * @returns {string}
 */
function resolveAltText(value, fallbackArgs) {
  if (typeof value === 'string' && value.trim() !== '') {
    return escapeHtml(value.trim()).slice(0, 500);
  }
  return buildAltText(fallbackArgs);
}

/**
 * Shapes a stored asset into the response envelope every /media endpoint returns.
 * One helper so the three handlers cannot drift into three shapes.
 */
function assetPayload({ stored, width, height, format, altText, hasLogo, logoPosition }) {
  return {
    relativePath: stored.relativePath,
    // `safeUrl` is belt-and-braces: the URL is built from a validated path, but
    // this value is rendered as an <img src> by the frontend and the check costs
    // nothing.
    publicUrl: safeUrl(stored.publicUrl),
    width,
    height,
    format,
    bytes: stored.bytes,
    contentType: stored.contentType,
    alt_text: altText,
    has_logo_overlay: hasLogo,
    logo_position: hasLogo ? logoPosition : 'none',
  };
}

/**
 * POST /media/upload — multipart image upload.
 *
 * Requires `imageUpload.single('image')` and `requireImageFile()` in front of it,
 * so `req.imageFile` is present and its bytes are already proven to be an image.
 */
const uploadImage = asyncHandler(async (req, res) => {
  const { logo_overlay: logoOverlay, logo_position: logoPosition, size_ratio: sizeRatio, opacity } =
    req.body;
  const file = req.imageFile;

  // Strips EXIF and bakes in orientation. Done before compositing so the logo is
  // placed relative to the image as the reader will actually see it.
  const normalised = await normalizeImage(file.buffer);

  // A logo_overlay toggle with no corner chosen is a wizard state, not an error.
  const position = logoOverlay ? (logoPosition === 'none' ? 'bottom_right' : logoPosition) : 'none';

  let buffer = normalised.buffer;
  let hasLogo = false;
  if (position !== 'none') {
    const composited = await compositeLogo(buffer, { position, sizeRatio, opacity });
    // Identity comparison: compositeLogo returns its input when no logo file
    // could be found, and the response must not claim a watermark that is absent.
    hasLogo = composited !== buffer;
    buffer = composited;
  }

  const meta = await sharp(buffer).metadata();
  const ext = FORMAT_EXTENSIONS[meta.format] || 'png';
  const stored = await storage.saveImage(buffer, { ext, contentType: file.contentType });

  logger.info('Image uploaded.', {
    userId: req.user.id,
    relativePath: stored.relativePath,
    bytes: stored.bytes,
    hasLogo,
  });

  res.status(201).json(
    assetPayload({
      stored,
      width: meta.width,
      height: meta.height,
      format: meta.format,
      altText: resolveAltText(req.body.alt_text, { topic: file.originalName }),
      hasLogo,
      logoPosition: position,
    })
  );
});

/**
 * POST /media/generate-image — AI image generation.
 *
 * Rate-limited by `generationLimiter` at the route, because each call spends real
 * money at the provider. Returns an array so a `count > 1` request is one
 * round-trip; a single image is still an array of one, so the client has one shape
 * to handle.
 */
const generateImage = asyncHandler(async (req, res) => {
  const {
    prompt,
    topic,
    style,
    logo_overlay: logoOverlay,
    logo_position: logoPosition,
    count,
    size_ratio: sizeRatio,
    opacity,
  } = req.body;

  const images = await generateBlogImage({
    prompt,
    topic,
    style,
    logoOverlay,
    logoPosition,
    count,
    sizeRatio,
    opacity,
  });

  logger.info('AI images generated.', {
    userId: req.user.id,
    count: images.length,
    style,
  });

  res.status(201).json({
    images: images.map((image) => ({
      ...image,
      publicUrl: safeUrl(image.publicUrl),
    })),
    count: images.length,
  });
});

/**
 * POST /media/composite-logo — apply or re-apply an overlay.
 *
 * Two sources, exactly one of which must be supplied:
 *   - `relative_path`: an image already in storage (the "I picked the wrong
 *     corner" case, which must not cost another provider call).
 *   - an `image` file upload, for a one-shot composite without a prior upload.
 *
 * Always writes a NEW path rather than overwriting, unless `replace` is set: the
 * previous file may already be referenced by published `blog_content` HTML, and
 * the local driver refuses to clobber an existing key in any case.
 */
const compositeLogoOnImage = asyncHandler(async (req, res) => {
  const {
    relative_path: relativePath,
    logo_position: logoPosition,
    size_ratio: sizeRatio,
    opacity,
    replace,
  } = req.body;
  const file = req.imageFile;

  if (!relativePath && !file) {
    throw ApiError.badRequest(
      'Provide either relative_path (an already-stored image) or an "image" file upload.',
      { code: 'COMPOSITE_SOURCE_MISSING' }
    );
  }
  if (relativePath && file) {
    // Ambiguous rather than harmless: guessing which one the caller meant would
    // silently discard an upload they believe was processed.
    throw ApiError.badRequest(
      'Provide relative_path or an "image" file upload, not both.',
      { code: 'COMPOSITE_SOURCE_AMBIGUOUS' }
    );
  }

  // `read()` runs the path through resolveSafePath, so a traversal attempt is
  // rejected here rather than reaching the filesystem.
  const sourceBuffer = file ? file.buffer : await storage.readFile(relativePath);

  const normalised = await normalizeImage(sourceBuffer);

  let buffer = normalised.buffer;
  let hasLogo = false;
  if (logoPosition !== 'none') {
    const composited = await compositeLogo(buffer, {
      position: logoPosition,
      sizeRatio,
      opacity,
    });
    hasLogo = composited !== buffer;
    buffer = composited;
  }

  const meta = await sharp(buffer).metadata();
  const ext = FORMAT_EXTENSIONS[meta.format] || 'png';

  let stored;
  if (replace && relativePath) {
    // Overwrite in place: delete then re-save at the same key, so every existing
    // reference (published HTML, og_image, a cached CDN entry) keeps working.
    await storage.deleteFile(relativePath);
    stored = await storage.saveBuffer(buffer, {
      relativePath,
      contentType: meta.format === 'jpeg' ? 'image/jpeg' : `image/${meta.format}`,
    });
  } else {
    stored = await storage.saveImage(buffer, { ext });
  }

  logger.info('Logo overlay applied.', {
    userId: req.user.id,
    source: file ? 'upload' : relativePath,
    relativePath: stored.relativePath,
    logoPosition,
    hasLogo,
    replaced: Boolean(replace && relativePath),
  });

  res.status(201).json({
    ...assetPayload({
      stored,
      width: meta.width,
      height: meta.height,
      format: meta.format,
      altText: resolveAltText(req.body.alt_text, { topic: relativePath || file.originalName }),
      hasLogo,
      logoPosition,
    }),
    sourcePath: relativePath || null,
  });
});

module.exports = {
  uploadImage,
  generateImage,
  compositeLogoOnImage,
  resolveAltText,
};
