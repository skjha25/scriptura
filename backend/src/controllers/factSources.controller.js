'use strict';

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const factSources = require('../services/factSources');
const { FACT_SOURCE_TYPES, FACT_SOURCE_PRIORITIES } = require('../constants');

/** GET /settings/fact-sources */
const listFactSources = asyncHandler(async (req, res) => {
  const data = await factSources.listFactSources();
  res.json({ data });
});

/** POST /settings/fact-sources — JSON body, website/reference_text only. */
const addFactSource = asyncHandler(async (req, res) => {
  const { name, sourceType, url, referenceText, tags, priority, active } = req.body;
  const created = await factSources.addFactSource({ name, sourceType, url, referenceText, tags, priority, active });
  res.status(201).json({ data: created });
});

/**
 * POST /settings/fact-sources/upload — multipart, document/pdf sources.
 * Text fields arrive as strings (multer flattens everything), so
 * `tags`/`active` are parsed here rather than through the JSON `validate`
 * middleware — same split brandVoice.controller.js's own upload handler uses.
 */
const uploadFactSource = asyncHandler(async (req, res) => {
  const { name, source_type: sourceType, tags: rawTags, priority, active: rawActive } = req.body;

  if (!name || !String(name).trim()) {
    throw ApiError.badRequest('name is required.', { code: 'FACT_SOURCE_NAME_REQUIRED' });
  }
  if (sourceType !== FACT_SOURCE_TYPES.DOCUMENT && sourceType !== FACT_SOURCE_TYPES.PDF) {
    throw ApiError.badRequest('source_type must be "document" or "pdf" for an upload.', { code: 'FACT_SOURCE_TYPE_INVALID' });
  }
  if (!req.file) {
    throw ApiError.badRequest('A file is required in the "file" field.', { code: 'FACT_SOURCE_FILE_REQUIRED' });
  }

  let tags = [];
  if (rawTags) {
    try {
      const parsed = JSON.parse(rawTags);
      if (Array.isArray(parsed)) tags = parsed;
    } catch {
      // Not JSON — treat as a single comma-separated field, the plainer
      // shape a hand-built multipart form would send.
      tags = String(rawTags).split(',').map((t) => t.trim()).filter(Boolean);
    }
  }

  const created = await factSources.addFactSource({
    name,
    sourceType,
    file: { buffer: req.file.buffer, originalname: req.file.originalname, mimetype: req.file.mimetype },
    tags,
    priority: Object.values(FACT_SOURCE_PRIORITIES).includes(priority) ? priority : undefined,
    active: rawActive === undefined ? true : rawActive !== 'false' && rawActive !== false,
  });

  res.status(201).json({ data: created });
});

/** PUT /settings/fact-sources/:id */
const updateFactSource = asyncHandler(async (req, res) => {
  const updated = await factSources.updateFactSource(req.params.id, req.body);
  res.json({ data: updated });
});

/** DELETE /settings/fact-sources/:id */
const removeFactSource = asyncHandler(async (req, res) => {
  await factSources.removeFactSource(req.params.id);
  res.status(204).send();
});

/** PUT /settings/fact-verification-policy */
const updateFactVerificationPolicy = asyncHandler(async (req, res) => {
  const policy = await factSources.setPolicy(req.body.policy);
  res.json({ data: { policy } });
});

module.exports = {
  listFactSources,
  addFactSource,
  uploadFactSource,
  updateFactSource,
  removeFactSource,
  updateFactVerificationPolicy,
};
