'use strict';

/**
 * P6-A: Zod schemas for the global content-configuration settings surface
 * (`/settings/image-defaults` today; fact sources and reusable links land
 * here too as later P6 sub-phases). Deliberately Zod + the shared `validate`
 * middleware — not the older inline-check style still used by the
 * pre-existing topics/autopilot handlers in settings.controller.js — because
 * it gives proper field-level 422 errors the frontend's existing
 * `ErrorBanner` component already knows how to render (see agents.validators.js
 * for the established convention this follows).
 */

const { z } = require('zod');

const { IMAGE_DIMENSION_MIN, IMAGE_DIMENSION_MAX } = require('../constants');

/** PUT /settings/image-defaults */
const imageDefaultsBody = z
  .object({
    width: z.coerce.number().int().min(IMAGE_DIMENSION_MIN).max(IMAGE_DIMENSION_MAX),
    height: z.coerce.number().int().min(IMAGE_DIMENSION_MIN).max(IMAGE_DIMENSION_MAX),
    lockAspectRatio: z.boolean().optional(),
  })
  .strict();

module.exports = {
  imageDefaultsBody,
};
