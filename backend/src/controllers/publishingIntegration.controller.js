'use strict';

/**
 * /config — client publish-API integrations: endpoint/auth config, field
 * mapping, test connection, delivery logs. See the Client Publish-API
 * Integration plan for the full design.
 *
 * `serializeIntegration` is the ONE place a `PublishingIntegration` row is
 * turned into a response — it never includes the decrypted secret, only
 * `has_secret: boolean`, so no code path can accidentally leak a credential.
 */

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const config = require('../config');
const { PublishingIntegration, PublishingFieldMapping, PublishingDeliveryLog, sequelize } = require('../models');
const credentialCrypto = require('../services/delivery/credentialCrypto');
const clientDeliveryService = require('../services/delivery/clientDeliveryService');
const { listAvailableFields, BLOG_FIELD_ALLOWLIST } = require('../services/delivery/payloadMapper');

function serializeFieldMapping(m) {
  return {
    id: m.id,
    client_field: m.client_field,
    source_type: m.source_type,
    scriptura_field: m.scriptura_field,
    static_value: m.static_value,
    is_required: m.is_required,
    sort_order: m.sort_order,
  };
}

function serializeIntegration(integration) {
  return {
    id: integration.id,
    name: integration.name,
    enabled: integration.enabled,
    endpoint_url: integration.endpoint_url,
    test_endpoint_url: integration.test_endpoint_url,
    auth_type: integration.auth_type,
    auth_header_name: integration.auth_header_name,
    request_format: integration.request_format,
    max_file_kb: integration.max_file_kb,
    // Never the decrypted value — only whether one is set.
    has_secret: Boolean(integration.auth_secret_encrypted),
    response_id_path: integration.response_id_path,
    response_url_path: integration.response_url_path,
    update_endpoint_url: integration.update_endpoint_url,
    update_id_field: integration.update_id_field,
    created_at: integration.created_at,
    updated_at: integration.updated_at,
    field_mappings: integration.fieldMappings
      ? [...integration.fieldMappings].sort((a, b) => a.sort_order - b.sort_order).map(serializeFieldMapping)
      : undefined,
  };
}

const listIntegrations = asyncHandler(async (req, res) => {
  // Eager-loads mappings too — the list card shows a mapped-field count, and
  // this table is admin-scale (a handful of client rows), not something
  // that needs a separate count query to stay cheap.
  const integrations = await PublishingIntegration.findAll({
    order: [['created_at', 'DESC']],
    include: [{ model: PublishingFieldMapping, as: 'fieldMappings' }],
  });
  res.json({ data: integrations.map(serializeIntegration) });
});

const getIntegration = asyncHandler(async (req, res) => {
  const integration = await PublishingIntegration.findByPk(req.params.id, {
    include: [{ model: PublishingFieldMapping, as: 'fieldMappings' }],
  });
  if (!integration) throw ApiError.notFound(`No integration with id ${req.params.id}.`);
  res.json({ data: serializeIntegration(integration) });
});

const createIntegration = asyncHandler(async (req, res) => {
  const { secret, ...rest } = req.body;
  const integration = await PublishingIntegration.create({
    ...rest,
    auth_secret_encrypted: secret ? credentialCrypto.encrypt(secret) : null,
  });
  res.status(201).json({ data: serializeIntegration(integration) });
});

const updateIntegration = asyncHandler(async (req, res) => {
  const integration = await PublishingIntegration.findByPk(req.params.id);
  if (!integration) throw ApiError.notFound(`No integration with id ${req.params.id}.`);

  const { secret, ...rest } = req.body;
  integration.set(rest);
  // Omitted entirely -> leave the existing secret untouched. Present (even
  // '') -> replace it — an empty string clears it (switching to auth_type
  // 'none' does the same, below).
  if (secret !== undefined) {
    integration.auth_secret_encrypted = secret ? credentialCrypto.encrypt(secret) : null;
  }
  if (integration.auth_type === 'none') integration.auth_secret_encrypted = null;

  await integration.save();
  res.json({ data: serializeIntegration(integration) });
});

const replaceFieldMappings = asyncHandler(async (req, res) => {
  const integration = await PublishingIntegration.findByPk(req.params.id);
  if (!integration) throw ApiError.notFound(`No integration with id ${req.params.id}.`);

  const invalid = req.body.mappings.find(
    (m) => m.source_type === 'field' && (!m.scriptura_field || !BLOG_FIELD_ALLOWLIST[m.scriptura_field])
  );
  if (invalid) {
    throw ApiError.unprocessable(`"${invalid.client_field}" is not mapped to a known Scriptura field.`, {
      code: 'UNKNOWN_SCRIPTURA_FIELD',
    });
  }

  await sequelize.transaction(async (t) => {
    await PublishingFieldMapping.destroy({ where: { integration_id: integration.id }, transaction: t });
    if (req.body.mappings.length > 0) {
      await PublishingFieldMapping.bulkCreate(
        req.body.mappings.map((m, i) => ({
          client_field: m.client_field,
          source_type: m.source_type,
          scriptura_field: m.source_type === 'field' ? m.scriptura_field : null,
          static_value: m.source_type === 'static' ? m.static_value ?? null : null,
          is_required: Boolean(m.is_required),
          sort_order: m.sort_order ?? i,
          integration_id: integration.id,
        })),
        { transaction: t }
      );
    }
  });

  const updated = await PublishingIntegration.findByPk(integration.id, {
    include: [{ model: PublishingFieldMapping, as: 'fieldMappings' }],
  });
  res.json({ data: serializeIntegration(updated) });
});

const testConnection = asyncHandler(async (req, res) => {
  const result = await clientDeliveryService.testConnection(req.params.id, { blogId: req.body.blog_id });
  res.json({
    success: result.error === null,
    used_test_endpoint: result.usedTestEndpoint,
    target_url: result.targetUrl,
    http_status: result.httpStatus,
    error: result.error,
    payload_preview: result.payload,
  });
});

const listDeliveryLogs = asyncHandler(async (req, res) => {
  const integration = await PublishingIntegration.findByPk(req.params.id);
  if (!integration) throw ApiError.notFound(`No integration with id ${req.params.id}.`);

  const where = { integration_id: integration.id };
  if (req.query.status) where.status = req.query.status;

  const limit = req.query.limit || config.pagination.defaultLimit;
  const page = req.query.page || 1;

  const { rows, count } = await PublishingDeliveryLog.findAndCountAll({
    where,
    order: [['created_at', 'DESC'], ['id', 'DESC']],
    limit,
    offset: (page - 1) * limit,
  });

  res.json({
    data: rows,
    pagination: {
      page,
      limit,
      total: count,
      total_pages: Math.max(1, Math.ceil(count / limit)),
      has_next: page * limit < count,
      has_prev: page > 1,
    },
  });
});

const retryDeliveryLog = asyncHandler(async (req, res) => {
  const log = await clientDeliveryService.retryDelivery(req.params.logId);
  res.json({ data: log });
});

const getAvailableFields = asyncHandler(async (req, res) => {
  res.json({ data: listAvailableFields() });
});

module.exports = {
  listIntegrations,
  getIntegration,
  createIntegration,
  updateIntegration,
  replaceFieldMappings,
  testConnection,
  listDeliveryLogs,
  retryDeliveryLog,
  getAvailableFields,
};
