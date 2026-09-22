// backend/src/validators/gsc.validators.js
'use strict';

/** Zod schema for POST /gsc/sync. */

const { z } = require('zod');

const syncBody = z
  .object({
    /** Defaults to config.gsc.siteUrl (services/gsc.js) when omitted. */
    site_url: z.string().trim().min(1).max(2048).optional(),
    /** Trailing window size in days, ending 2 days ago (GSC's own processing lag). */
    days: z.coerce.number().int().min(1).max(30).optional(),
  })
  .strict();

module.exports = { syncBody };
