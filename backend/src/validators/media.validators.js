// backend/src/validators/media.validators.js
'use strict';

/**
 * Zod schemas for the /media endpoints.
 *
 * The awkward part of validating these routes is that two of them are multipart:
 * Multer puts text fields on `req.body` as STRINGS, so `logo_overlay=true`
 * arrives as `'true'` and `count=2` as `'2'`. The same endpoints also accept a
 * JSON body (composite-logo against an already-stored path), where those fields
 * arrive properly typed.
 *
 * So every non-string field here goes through a coercing preprocessor that
 * handles both. Doing it in the schema — rather than in the controller — keeps
 * the "parsed, coerced, stripped" guarantee that middleware/validate.js promises
 * every handler.
 *
 * Field names are snake_case to match the `blogs` columns they map onto
 * (`logo_overlay`, `logo_position`), so the wizard can post its own state
 * without translating.
 */

const { z } = require('zod');

const {
  IMAGE_STYLES,
  LOGO_POSITIONS,
  IMAGE_COUNT_MIN,
  IMAGE_COUNT_MAX,
} = require('../constants');
const {
  MIN_SIZE_RATIO,
  MAX_SIZE_RATIO,
  DEFAULT_SIZE_RATIO,
  DEFAULT_OPACITY,
} = require('../services/logoComposite');

/**
 * Accepts `true`/`'true'`/`'1'`/`'on'`/`'yes'` and their negatives.
 *
 * A checkbox that is unchecked is simply absent from a multipart body, so an
 * undefined value must fall through to the schema's default rather than fail.
 */
function boolish(defaultValue) {
  return z.preprocess((value) => {
    if (value === undefined || value === '') return defaultValue;
    if (typeof value === 'boolean') return value;
    const text = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'off'].includes(text)) return false;
    // Anything else is left alone so Zod reports a type error naming the field,
    // instead of it being coerced to `false` and silently ignored.
    return value;
  }, z.boolean());
}

/**
 * Numeric field that may arrive as a multipart string.
 *
 * The bounded inner schema is passed in rather than chained on afterwards:
 * `z.preprocess` returns a ZodEffects, which has no `.int()`/`.min()`/`.max()`,
 * so the constraints have to be built into the number schema before wrapping.
 *
 * @param {number} defaultValue Used for an absent or empty field.
 * @param {import('zod').ZodNumber} [inner]
 */
function numberish(defaultValue, inner = z.number()) {
  return z.preprocess((value) => {
    if (value === undefined || value === '') return defaultValue;
    if (typeof value === 'number') return value;
    const parsed = Number(String(value).trim());
    // A non-numeric string is passed through unchanged so Zod reports a type
    // error naming the field rather than silently substituting NaN.
    return Number.isNaN(parsed) ? value : parsed;
  }, inner);
}

/** Free-text field: trimmed, empty-to-undefined so `?field=` is not a value. */
function optionalText(max) {
  return z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return trimmed === '' ? undefined : trimmed;
    },
    z.string().max(max).optional()
  );
}

const logoPositionSchema = z.enum(LOGO_POSITIONS);
const imageStyleSchema = z.enum(IMAGE_STYLES);

const sizeRatioSchema = numberish(
  DEFAULT_SIZE_RATIO,
  z
    .number()
    .min(MIN_SIZE_RATIO, { message: `size_ratio must be at least ${MIN_SIZE_RATIO}.` })
    .max(MAX_SIZE_RATIO, { message: `size_ratio must be at most ${MAX_SIZE_RATIO}.` })
);

const opacitySchema = numberish(
  DEFAULT_OPACITY,
  z
    .number()
    .min(0, { message: 'opacity must be at least 0.' })
    .max(1, { message: 'opacity must be at most 1.' })
);

/**
 * `POST /media/upload` — multipart. The file itself is validated by
 * middleware/upload.js (magic bytes + decode); this covers the text fields.
 *
 * `logo_position` defaults to 'none' rather than a corner: an upload that did not
 * ask for a watermark must not get one.
 */
const uploadImageBody = z.object({
  logo_overlay: boolish(false),
  logo_position: logoPositionSchema.default('none'),
  size_ratio: sizeRatioSchema,
  opacity: opacitySchema,
  alt_text: optionalText(500),
});

/**
 * `POST /media/generate-image` — JSON.
 *
 * `prompt` or `topic` is required, checked with `superRefine` so the error names
 * both fields; a plain `.refine` would attach it to the object root and the
 * wizard could not highlight anything.
 */
const generateImageBody = z
  .object({
    prompt: optionalText(2000),
    topic: optionalText(255),
    style: imageStyleSchema.default('photo'),
    logo_overlay: boolish(false),
    logo_position: logoPositionSchema.default('none'),
    count: numberish(
      IMAGE_COUNT_MIN,
      z
        .number()
        .int({ message: 'count must be a whole number.' })
        .min(IMAGE_COUNT_MIN, { message: `count must be at least ${IMAGE_COUNT_MIN}.` })
        .max(IMAGE_COUNT_MAX, { message: `count must be at most ${IMAGE_COUNT_MAX}.` })
    ),
    size_ratio: sizeRatioSchema,
    opacity: opacitySchema,
  })
  .superRefine((value, ctx) => {
    if (!value.prompt && !value.topic) {
      for (const field of ['prompt', 'topic']) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: 'Provide either a prompt or a topic to generate an image from.',
        });
      }
    }
  });

/**
 * `POST /media/composite-logo` — JSON with `relative_path`, or multipart with an
 * `image` file.
 *
 * `relative_path` is only shape-checked here; the real defence against traversal
 * is `resolveSafePath` inside the storage driver. This regex is a cheap early
 * rejection that also produces a much better error message than a 400 from the
 * driver would.
 *
 * `logo_position` is required, with no default: this endpoint exists to place a
 * logo, so guessing a corner would be presumptuous. 'none' remains legal because
 * it is how the UI removes an overlay by re-compositing from the original.
 */
const compositeLogoBody = z.object({
  relative_path: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z
      .string()
      .max(500)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/, {
        message:
          'relative_path must be a storage-relative path such as ' +
          'blogs/July2026/abc.png — no leading slash, drive letter or ".." segment.',
      })
      .optional()
  ),
  logo_position: logoPositionSchema,
  size_ratio: sizeRatioSchema,
  opacity: opacitySchema,
  alt_text: optionalText(500),
  /**
   * Whether to overwrite the source path or write a new asset.
   *
   * Defaults to false — a new path — because the old file may still be referenced
   * by an already-published `blog_content` HTML blob, and the local driver refuses
   * to overwrite in any case.
   */
  replace: boolish(false),
});
// "exactly one source" is not checkable here: the uploaded file lives on
// `req.file`, not `req.body`, so the controller completes that check.

module.exports = {
  uploadImageBody,
  generateImageBody,
  compositeLogoBody,
  logoPositionSchema,
  imageStyleSchema,
  sizeRatioSchema,
  opacitySchema,
  boolish,
  numberish,
};
