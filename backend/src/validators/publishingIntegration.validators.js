// backend/src/validators/publishingIntegration.validators.js
'use strict';

/**
 * Zod schemas for the /config (client publish-API integration) endpoints.
 *
 * `secret` is the ONLY place a plaintext credential ever appears in a
 * request body — it is encrypted (services/delivery/credentialCrypto.js)
 * before it touches the database, and never appears in any response (see
 * the controller's `serializeIntegration`, which only ever exposes
 * `has_secret: boolean`).
 */

const { z } = require('zod');

const authType = z.enum(['none', 'bearer', 'api_key', 'custom_header']);

/** Empty string clears an optional URL/path field on update. */
const optionalUrl = z.string().trim().max(2048).optional().or(z.literal(''));
const optionalPath = z.string().trim().max(255).optional().or(z.literal(''));

const integrationFields = {
  name: z.string().trim().min(1, 'A name is required.').max(255),
  enabled: z.boolean().optional(),
  endpoint_url: z.string().trim().min(1, 'An endpoint URL is required.').max(2048),
  test_endpoint_url: optionalUrl,
  auth_type: authType.optional(),
  request_format: z.enum(['json', 'multipart']).optional(),
  /** Only meaningful for request_format='multipart' — caps a mapped file field's size, compressing down to fit. Omitted = no cap. */
  max_file_kb: z.coerce.number().int().positive().max(51200).optional(),
  auth_header_name: z.string().trim().max(100).optional().or(z.literal('')),
  /** Plaintext in, encrypted before storage. Omit to leave an existing secret unchanged on update. */
  secret: z.string().trim().max(4000).optional(),
  response_id_path: optionalPath,
  response_url_path: optionalPath,
  /** Republish of an already-delivered blog goes here instead of endpoint_url. Needs response_id_path to capture the client's post id. */
  update_endpoint_url: optionalUrl,
  /** Request field the client's post id is sent under on update. Empty = 'id'. */
  update_id_field: optionalPath,
};

const createIntegrationBody = z.object(integrationFields).strict();

const updateIntegrationBody = z
  .object({ ...integrationFields, name: integrationFields.name.optional(), endpoint_url: integrationFields.endpoint_url.optional() })
  .strict();

const fieldMappingItem = z
  .object({
    /** Ignored — a client resaving the list straight from the GET response shape carries this; the replace always fully rebuilds the rows regardless. */
    id: z.union([z.number(), z.string()]).optional(),
    client_field: z.string().trim().min(1, 'A client field name is required.').max(255),
    source_type: z.enum(['field', 'static']),
    /** Required when source_type='field' — checked against the real allowlist in the controller, not here. */
    scriptura_field: z.string().trim().max(100).optional(),
    /** Nullable because the GET response shape carries a DB-null static_value for field-type rows — a resave sends that back verbatim. */
    static_value: z.string().max(4000).nullable().optional(),
    is_required: z.boolean().optional(),
    sort_order: z.coerce.number().int().optional(),
  })
  .strict();

const replaceFieldMappingsBody = z
  .object({
    mappings: z.array(fieldMappingItem).max(100, 'A single integration cannot have more than 100 mapped fields.'),
  })
  .strict();

const testConnectionBody = z
  .object({
    blog_id: z.coerce.number().int().positive().optional(),
  })
  .strict();

const listDeliveryLogsQuery = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    status: z.enum(['pending', 'delivered', 'failed']).optional(),
  })
  .strict();

module.exports = {
  createIntegrationBody,
  updateIntegrationBody,
  replaceFieldMappingsBody,
  testConnectionBody,
  listDeliveryLogsQuery,
};
