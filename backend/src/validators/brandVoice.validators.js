'use strict';

/**
 * Zod schemas for POST /brand-voice/analyze.
 *
 * ---------------------------------------------------------------------------
 * WHY A DISCRIMINATED UNION ON source_type
 * ---------------------------------------------------------------------------
 * The three sources need three different required fields, and a single flat
 * object with everything optional would accept `{source_type: 'web_scrape'}`
 * with no URL and then fail deeper in the service with a worse message.
 * Discriminating on `source_type` means the 422 names the exact missing field.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FILE BRANCH VALIDATES NO FILE FIELD
 * ---------------------------------------------------------------------------
 * On a multipart request the file arrives on `req.file` (Multer), not in
 * `req.body`, so there is nothing in the body to validate. The controller checks
 * `req.file` itself and raises the 422. Pretending otherwise here would produce a
 * schema that looks like it guarantees something it cannot see.
 */

const { z } = require('zod');

const { BRAND_VOICE_SOURCE_TYPES } = require('../constants');
const { MIN_SAMPLE_CHARS } = require('../services/brandVoice');

/** Ceiling on pasted text. ~40k chars is a long article; the model cap is lower. */
const MAX_TEXT_CHARS = 40000;

/**
 * Multipart bodies arrive as strings, so booleans and numbers have to be
 * coerced. `save_to_blog_id` lets the wizard analyse and attach in one call.
 */
const blogIdField = z.coerce.number().int().positive().optional();

/**
 * All three branches are `.strict()`.
 *
 * This is not tidiness. `confirmed` is exactly the field a client must never be
 * able to set on an analysis — the whole point of Section 4 Step 2 is that only a
 * separate, deliberate human action may confirm a voice. Stripping an unknown key
 * silently would accept `{confirmed: true}` and give a 200, which reads to the
 * caller as though it worked. Rejecting says so.
 */
const textSource = z
  .object({
    source_type: z.literal('text'),
    text: z
      .string()
      .trim()
      .min(MIN_SAMPLE_CHARS, `Paste at least ${MIN_SAMPLE_CHARS} characters of real published copy.`)
      .max(MAX_TEXT_CHARS, `At most ${MAX_TEXT_CHARS} characters.`),
    blog_id: blogIdField,
  })
  .strict();

const urlSource = z
  .object({
    source_type: z.literal('web_scrape'),
    /**
     * Only shape is validated here. Whether the URL is *safe to fetch* is decided
     * by services/brandVoice.assertSafeUrl, which needs DNS and therefore cannot
     * live in a synchronous Zod schema. Keeping the SSRF decision in one
     * unit-tested place is deliberate — a partial check in a validator would
     * invite the reader to assume the job was done here.
     */
    url: z.string().trim().min(1, 'A URL is required.').max(2000).url('Provide a valid absolute URL.'),
    blog_id: blogIdField,
  })
  .strict();

const fileSource = z
  .object({
    source_type: z.literal('file_upload'),
    blog_id: blogIdField,
  })
  .strict();

/** POST /brand-voice/analyze */
const analyzeBrandVoiceBody = z.discriminatedUnion('source_type', [textSource, urlSource, fileSource], {
  errorMap: () => ({
    message: `source_type must be one of ${BRAND_VOICE_SOURCE_TYPES.filter((t) => t !== 'none').join(', ')}.`,
  }),
});

module.exports = {
  analyzeBrandVoiceBody,
  textSource,
  urlSource,
  fileSource,
  MAX_TEXT_CHARS,
};
