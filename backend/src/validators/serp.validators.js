// backend/src/validators/serp.validators.js
'use strict';

/**
 * Zod schemas for the /serp endpoints.
 *
 * The domain field is deliberately permissive about form — `divinetalk.in`,
 * `https://divinetalk.in/blog/x` and `www.divinetalk.in` are all accepted and
 * reduced to a hostname by services/serp.hostOf. Rejecting a pasted full URL
 * would be technically defensible and practically annoying, since pasting the
 * article URL is what a user actually does.
 */

const { z } = require('zod');

/** ISO 3166-1 alpha-2, lower case, as SerpAPI's `gl` parameter expects. */
const countryCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{2}$/, 'Use a two-letter country code, e.g. "in".')
  .optional();

const keywordField = z
  .string()
  .trim()
  .min(1, 'A keyword is required.')
  .max(255, 'A keyword must be at most 255 characters.');

/** POST /serp/check-rank */
const checkRankBody = z
  .object({
    keyword: keywordField,
    /**
     * Anything hostname-shaped or URL-shaped. The regex allows an optional
     * scheme, an optional path, and rejects whitespace and obvious junk; the
     * authoritative parse is hostOf().
     */
    domain: z
      .string()
      .trim()
      .min(3, 'A domain is required.')
      .max(255)
      .regex(
        /^(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{2,5})?(?:\/.*)?$/i,
        'Provide a domain such as "divinetalk.in" or a full article URL.'
      ),
    /** When present, the result is written to the blog's serp_rank_* columns. */
    blog_id: z.coerce.number().int().positive().optional(),
    country: countryCode,
  })
  .strict();

/** POST /serp/ground-facts */
const groundFactsBody = z
  .object({
    topic: z.string().trim().min(1, 'A topic is required.').max(255),
    keyword: z.string().trim().min(1).max(255).optional(),
    country: countryCode,
  })
  .strict();

module.exports = { checkRankBody, groundFactsBody, countryCode };
