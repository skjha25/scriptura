'use strict';

/**
 * Server-side brand-logo compositing with sharp.
 *
 * Why server-side: the overlay has to be burned into the bytes that get stored,
 * because the images are consumed by the public Divinetalk site, by social
 * scrapers reading `og_image`, and by whatever else already reads the `blogs`
 * table. A CSS overlay in the editor would satisfy none of those.
 *
 * Three design decisions worth knowing:
 *
 *   1. GEOMETRY IS A PURE FUNCTION. `computeOverlayGeometry()` does all the
 *      arithmetic and touches no image data, so every position and clamp is unit
 *      tested without decoding a pixel. `compositeLogo()` is then a thin shell
 *      around sharp.
 *
 *   2. EVERYTHING IS PROPORTIONAL TO THE BASE WIDTH. The same call has to look
 *      right on a 512px inline illustration and a 1792px hero, so the logo size
 *      and its inset are both ratios, never pixel constants.
 *
 *   3. A MISSING LOGO MUST NOT FAIL A GENERATION. Losing the watermark on one
 *      image is a cosmetic problem; losing a paid four-image generation run
 *      because `LOGO_PATH` was mistyped is not. So the logo is searched for
 *      across a candidate list and, if none of them exist, the base image is
 *      returned untouched with a warning.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const config = require('../config');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { LOGO_POSITIONS } = require('../constants');

/**
 * Logo width as a fraction of the base image width.
 *
 * 0.18 is the smallest size at which the placeholder wordmark stays legible on a
 * 1024px image (~184px wide) while still reading as a watermark rather than as
 * the subject. Below ~0.12 the "ASTROLOGY" line turns to mush; above ~0.25 it
 * starts competing with the artwork.
 */
const DEFAULT_SIZE_RATIO = 0.18;

/**
 * Logo alpha multiplier. 0.9 rather than 1.0 so the mark sits *in* the image
 * instead of on top of it, while staying opaque enough to survive the
 * re-compression social platforms apply to shared images.
 */
const DEFAULT_OPACITY = 0.9;

/**
 * Inset from the edge, as a fraction of the base width. 0.04 (~41px at 1024)
 * keeps the mark clear of the safe-area crops Instagram and WhatsApp apply to
 * link previews, which bite at roughly 3%.
 */
const MARGIN_RATIO = 0.04;

/** Hard bounds, so a client cannot pass a ratio that swallows the image. */
const MIN_SIZE_RATIO = 0.02;
const MAX_SIZE_RATIO = 0.6;

/** The logo shipped with the repo, used when nothing else is configured. */
const BUNDLED_LOGO_PATH = path.join(__dirname, '..', 'assets', 'logo.png');

/** Output quality per format. High enough that a watermark pass is not visible. */
const OUTPUT_OPTIONS = Object.freeze({
  jpeg: { quality: 88, mozjpeg: true },
  webp: { quality: 88 },
  png: { compressionLevel: 9 },
});

/** Formats we will re-encode to. Anything else is normalised to png. */
const SUPPORTED_OUTPUT_FORMATS = Object.freeze(['jpeg', 'png', 'webp']);

/**
 * Clamps a numeric option, falling back for `undefined`/NaN rather than throwing.
 * Validation of client input happens in the Zod schemas; this is the last-resort
 * guard for internal callers.
 */
function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Works out where the logo goes and how big it is.
 *
 * Pure arithmetic — no sharp, no filesystem — which is why this is exported
 * separately and carries the bulk of the unit tests.
 *
 * Clamping order matters and is deliberate:
 *   1. Scale to `sizeRatio` of the base width, preserving the logo's aspect.
 *   2. Shrink to fit inside the margins on both axes if it does not.
 *   3. If the base is so small that even a zero-margin logo overflows, shrink to
 *      the base itself and drop the margin. A 64x64 favicon-sized base still
 *      gets a valid, in-bounds overlay rather than a sharp "image exceeds
 *      composite bounds" error.
 *
 * @param {object} args
 * @param {number} args.baseWidth
 * @param {number} args.baseHeight
 * @param {number} args.logoWidth Intrinsic logo width.
 * @param {number} args.logoHeight Intrinsic logo height.
 * @param {string} [args.position] One of constants.LOGO_POSITIONS.
 * @param {number} [args.sizeRatio]
 * @returns {{width: number, height: number, left: number, top: number, margin: number}}
 *   Integer pixel values, guaranteed to satisfy
 *   `left + width <= baseWidth` and `top + height <= baseHeight`.
 */
function computeOverlayGeometry({
  baseWidth,
  baseHeight,
  logoWidth,
  logoHeight,
  position = 'bottom_right',
  sizeRatio = DEFAULT_SIZE_RATIO,
}) {
  const bw = Math.max(1, Math.floor(Number(baseWidth) || 0));
  const bh = Math.max(1, Math.floor(Number(baseHeight) || 0));
  const lw = Math.max(1, Math.floor(Number(logoWidth) || 0));
  const lh = Math.max(1, Math.floor(Number(logoHeight) || 0));

  const ratio = clampNumber(sizeRatio, MIN_SIZE_RATIO, MAX_SIZE_RATIO, DEFAULT_SIZE_RATIO);
  const aspect = lh / lw;

  let margin = Math.round(bw * MARGIN_RATIO);
  let width = Math.max(1, Math.round(bw * ratio));
  let height = Math.max(1, Math.round(width * aspect));

  // Step 2: fit within the margins.
  const maxWidth = bw - margin * 2;
  const maxHeight = bh - margin * 2;
  if (maxWidth > 0 && maxHeight > 0) {
    const scale = Math.min(1, maxWidth / width, maxHeight / height);
    if (scale < 1) {
      width = Math.max(1, Math.floor(width * scale));
      height = Math.max(1, Math.floor(height * scale));
    }
  }

  // Step 3: the base is too small to hold a margin at all.
  if (width + margin * 2 > bw || height + margin * 2 > bh) {
    margin = 0;
    const scale = Math.min(1, bw / width, bh / height);
    width = Math.max(1, Math.min(bw, Math.floor(width * scale)));
    height = Math.max(1, Math.min(bh, Math.floor(height * scale)));
  }

  const right = bw - width - margin;
  const bottom = bh - height - margin;
  const centreLeft = Math.round((bw - width) / 2);
  const centreTop = Math.round((bh - height) / 2);

  const placements = {
    top_left: { left: margin, top: margin },
    top_right: { left: right, top: margin },
    bottom_left: { left: margin, top: bottom },
    bottom_right: { left: right, top: bottom },
    center: { left: centreLeft, top: centreTop },
  };

  // An unknown position is a programming error upstream; bottom_right is the
  // house default and is safer than throwing mid-generation.
  const placement = placements[position] || placements.bottom_right;

  return {
    width,
    height,
    // Negative offsets are impossible after the clamps above, but sharp rejects
    // them outright, so the floor is cheap insurance.
    left: Math.max(0, Math.min(placement.left, bw - width)),
    top: Math.max(0, Math.min(placement.top, bh - height)),
    margin,
  };
}

/**
 * First existing file from a candidate list.
 *
 * Exported so the "no logo anywhere" branch is testable without deleting the
 * bundled asset.
 *
 * @param {Array<string|null|undefined>} candidates Checked in order.
 * @returns {string|null} Absolute path, or null when none exist.
 */
function resolveLogoPath(candidates) {
  for (const candidate of candidates || []) {
    if (typeof candidate !== 'string' || candidate.trim() === '') continue;
    const absolute = path.isAbsolute(candidate)
      ? candidate
      : path.resolve(config.backendRoot, candidate);
    // Synchronous on purpose: this runs once per image, resolves from a tiny
    // fixed list, and hits the OS cache after the first call.
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) return absolute;
  }
  return null;
}

/**
 * Reads the base image's metadata, converting sharp's failure into a clear 415.
 *
 * A non-image buffer is a routine client mistake (a PDF renamed to .png), not a
 * server fault, so it must not surface as a 500 with a libvips message.
 *
 * @param {Buffer} buffer
 * @returns {Promise<import('sharp').Metadata>}
 */
async function readImageMetadata(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw ApiError.badRequest('No image data was provided.', { code: 'IMAGE_EMPTY' });
  }
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch (err) {
    throw new ApiError(415, 'The file is not a readable image.', {
      code: 'IMAGE_UNREADABLE',
      cause: err,
    });
  }
  if (!meta.format || !meta.width || !meta.height) {
    throw new ApiError(415, 'The file is not a readable image.', { code: 'IMAGE_UNREADABLE' });
  }
  return meta;
}

/** The output format to re-encode in: the input's, or png if exotic. */
function outputFormatFor(metadata) {
  return SUPPORTED_OUTPUT_FORMATS.includes(metadata.format) ? metadata.format : 'png';
}

/**
 * Dimensions as they will appear AFTER EXIF orientation is applied.
 *
 * `metadata()` reports the stored pixel dimensions, but every pipeline here calls
 * `.rotate()` first, which swaps them for orientation 5–8 (the sideways phone
 * photo cases). Computing geometry from the unrotated numbers would place a
 * bottom-right overlay outside the canvas and make sharp throw.
 *
 * @param {import('sharp').Metadata} metadata
 * @returns {{width: number, height: number}}
 */
function orientedDimensions(metadata) {
  const swapped = Number(metadata.orientation) >= 5;
  return {
    width: swapped ? metadata.height : metadata.width,
    height: swapped ? metadata.width : metadata.height,
  };
}

/**
 * Re-encodes an image, applying EXIF orientation and dropping all metadata.
 *
 * Two things happen here and both matter:
 *
 *   - `.rotate()` with no argument bakes the EXIF orientation flag into the
 *     pixels. Without it, stripping EXIF would leave a phone photo sideways.
 *   - sharp writes no metadata unless asked, so the output carries no EXIF —
 *     which is the point. Uploaded photos routinely embed GPS coordinates, and
 *     these files are served publicly.
 *
 * @param {Buffer} buffer
 * @returns {Promise<{buffer: Buffer, format: string, width: number, height: number}>}
 */
async function normalizeImage(buffer) {
  const meta = await readImageMetadata(buffer);
  const format = outputFormatFor(meta);

  const output = await sharp(buffer)
    .rotate()
    .toFormat(format, OUTPUT_OPTIONS[format])
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: output.data,
    format: output.info.format,
    width: output.info.width,
    height: output.info.height,
  };
}

/**
 * Produces a resized, alpha-modulated logo ready to composite.
 *
 * Opacity is applied by multiplying the LOGO's alpha channel — a 1x1 RGBA tile
 * composited with `dest-in`, which is `dest.alpha *= src.alpha`. The obvious
 * alternative (flattening the base and blending) would recompress the whole base
 * image and lose its transparency, so it is not used.
 *
 * @param {Buffer} logoBuffer
 * @param {{width: number, height: number}} size
 * @param {number} opacity 0..1. Must already be clamped — the caller does that,
 *   so a junk value cannot slip past a `< 1` comparison (NaN fails every
 *   comparison, which would silently mean "fully opaque").
 * @returns {Promise<Buffer>} PNG with alpha.
 */
async function prepareLogo(logoBuffer, { width, height }, opacity) {
  let pipeline = sharp(logoBuffer)
    .resize(width, height, { fit: 'inside', withoutEnlargement: false })
    .ensureAlpha();

  if (opacity < 1) {
    const alpha = Math.round(opacity * 255);
    pipeline = pipeline.composite([
      {
        input: Buffer.from([255, 255, 255, alpha]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: 'dest-in',
      },
    ]);
  }

  return pipeline.png().toBuffer();
}

/**
 * Overlays the brand logo onto an image.
 *
 * @param {Buffer} imageBuffer The base image.
 * @param {object} [options]
 * @param {string} [options.position] One of constants.LOGO_POSITIONS. `'none'`
 *   returns the input buffer unchanged (by identity — no re-encode).
 * @param {number} [options.sizeRatio] Logo width / base width. Default 0.18,
 *   clamped to 0.02..0.6.
 * @param {number} [options.opacity] 0..1, applied to the logo only. Default 0.9.
 * @param {string} [options.logoPath] Overrides `config.logoPath` for this call.
 * @param {Array<string>} [options.logoCandidates] Full search order override.
 *   Exists so the "no logo available anywhere" fallback can be tested; normal
 *   callers use `logoPath`.
 * @returns {Promise<Buffer>} The composited image, in the base image's format.
 * @throws {ApiError} 415 when `imageBuffer` is not a readable image.
 */
async function compositeLogo(imageBuffer, options = {}) {
  const {
    position = 'bottom_right',
    sizeRatio = DEFAULT_SIZE_RATIO,
    opacity = DEFAULT_OPACITY,
    logoPath,
    logoCandidates,
  } = options;

  if (position === 'none' || position === undefined || position === null) {
    // Validate nothing and re-encode nothing: 'none' is the common case for
    // blogs with the overlay switched off, and it should cost nothing.
    return imageBuffer;
  }
  if (!LOGO_POSITIONS.includes(position)) {
    throw ApiError.badRequest(
      `logo_position must be one of ${LOGO_POSITIONS.join(', ')} (got "${position}").`,
      { code: 'LOGO_POSITION_INVALID' }
    );
  }

  const baseMeta = await readImageMetadata(imageBuffer);
  const base = orientedDimensions(baseMeta);

  const resolvedLogo = resolveLogoPath(
    logoCandidates || [logoPath, config.logoPath, BUNDLED_LOGO_PATH]
  );
  if (!resolvedLogo) {
    // Deliberately not an error — see decision 3 in the file header.
    logger.warn(
      'Skipping logo overlay: no logo file found. Set LOGO_PATH in backend/.env ' +
        `or restore ${BUNDLED_LOGO_PATH}.`,
      { position }
    );
    return imageBuffer;
  }

  const sourceLogo = await fs.promises.readFile(resolvedLogo);
  const logoMeta = await readImageMetadata(sourceLogo);

  const geometry = computeOverlayGeometry({
    baseWidth: base.width,
    baseHeight: base.height,
    logoWidth: logoMeta.width,
    logoHeight: logoMeta.height,
    position,
    sizeRatio,
  });

  // Clamped here rather than inside prepareLogo: a NaN opacity fails every
  // comparison, so an unclamped value would slip past the `< 1` check there and
  // silently mean "fully opaque" instead of falling back to the default.
  const logoBuffer = await prepareLogo(
    sourceLogo,
    geometry,
    clampNumber(opacity, 0, 1, DEFAULT_OPACITY)
  );

  // `fit: 'inside'` above can come back a pixel short of the requested box when
  // rounding the aspect ratio, so the real dimensions drive the offsets. Without
  // this, a bottom_right overlay drifts by up to a pixel from the margin.
  const actual = await sharp(logoBuffer).metadata();
  const left = Math.max(0, Math.min(geometry.left, base.width - actual.width));
  const top = Math.max(0, Math.min(geometry.top, base.height - actual.height));

  const format = outputFormatFor(baseMeta);

  try {
    return await sharp(imageBuffer)
      .rotate()
      .composite([{ input: logoBuffer, left, top, blend: 'over' }])
      .toFormat(format, OUTPUT_OPTIONS[format])
      .toBuffer();
  } catch (err) {
    throw new ApiError(500, 'Could not apply the logo overlay to the image.', {
      code: 'LOGO_COMPOSITE_FAILED',
      cause: err,
    });
  }
}

module.exports = {
  compositeLogo,
  computeOverlayGeometry,
  resolveLogoPath,
  normalizeImage,
  readImageMetadata,
  outputFormatFor,
  orientedDimensions,
  BUNDLED_LOGO_PATH,
  DEFAULT_SIZE_RATIO,
  DEFAULT_OPACITY,
  MARGIN_RATIO,
  MIN_SIZE_RATIO,
  MAX_SIZE_RATIO,
  SUPPORTED_OUTPUT_FORMATS,
};
