'use strict';

/**
 * P6-B: Zod schemas for the JSON-bodied fact-source endpoints. The file
 * upload endpoint (`POST /settings/fact-sources/upload`, for `document`/`pdf`
 * sources) is multipart and validated in the controller instead — the same
 * split brandVoice.routes.js already uses between its JSON `/analyze` route
 * and its multipart file route.
 */

const { z } = require('zod');

const { FACT_SOURCE_TYPES, FACT_SOURCE_PRIORITIES, FACT_VERIFICATION_POLICIES } = require('../constants');

const JSON_SOURCE_TYPES = [FACT_SOURCE_TYPES.WEBSITE, FACT_SOURCE_TYPES.REFERENCE_TEXT];

/** POST /settings/fact-sources — website or reference_text only; document/pdf go through the multipart upload endpoint. */
const addFactSourceBody = z
  .object({
    name: z.string().trim().min(1).max(150),
    sourceType: z.enum(JSON_SOURCE_TYPES),
    url: z.string().trim().url().optional(),
    referenceText: z.string().trim().min(1).max(20000).optional(),
    tags: z.array(z.string().max(40)).max(10).optional(),
    priority: z.enum(Object.values(FACT_SOURCE_PRIORITIES)).optional(),
    active: z.boolean().optional(),
  })
  .strict();

/** PUT /settings/fact-sources/:id — metadata only, never re-fetches content. */
const updateFactSourceBody = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    tags: z.array(z.string().max(40)).max(10).optional(),
    priority: z.enum(Object.values(FACT_SOURCE_PRIORITIES)).optional(),
    active: z.boolean().optional(),
  })
  .strict();

const factSourceIdParams = z.object({ id: z.string().min(1) }).strict();

/** PUT /settings/fact-verification-policy */
const factVerificationPolicyBody = z
  .object({
    policy: z.enum(Object.values(FACT_VERIFICATION_POLICIES)),
  })
  .strict();

module.exports = {
  addFactSourceBody,
  updateFactSourceBody,
  factSourceIdParams,
  factVerificationPolicyBody,
};
