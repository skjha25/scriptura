'use strict';

/**
 * P1-B4: the executor registry for automated recommendation actions.
 *
 * An `action_type` listed here is the whitelist of real, structured `Blog`
 * mutations an approved recommendation's action can perform. Anything NOT
 * listed here stays exactly as it was before this file existed — a
 * human-tracked, self-reported (`executor_type:'manual'`) action with no
 * real mutation attached. See recommendationActions.js's `createAction`/
 * `executeAction` for how this registry is consulted.
 *
 * Each entry is `{ parametersSchema, execute(blog, parameters) }`:
 *   - `parametersSchema` (zod) validates `parameters` at action-creation
 *     time, before the row ever exists as `pending`.
 *   - `execute(blog, parameters)` performs the mutation against an
 *     already-loaded `Blog` instance and returns
 *     `{ before, after, mutatedFields }` — server-computed evidence, never
 *     trusted from the client.
 */

const { z } = require('zod');
const ApiError = require('../../utils/ApiError');

const updateSeoFieldsSchema = z
  .object({
    blog_id: z.coerce.number().int().positive(),
    meta_title: z.string().trim().max(255).optional(),
    meta_description: z.string().trim().max(500).optional(),
    secondary_keywords: z.array(z.string().trim().min(1)).max(50).optional(),
    canonical_url: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.meta_title !== undefined ||
      data.meta_description !== undefined ||
      data.secondary_keywords !== undefined ||
      data.canonical_url !== undefined,
    { message: 'At least one of meta_title, meta_description, secondary_keywords, canonical_url is required.' }
  );

const SEO_PATCH_FIELDS = ['meta_title', 'meta_description', 'secondary_keywords', 'canonical_url'];

async function executeUpdateSeoFields(blog, parameters) {
  const before = {};
  const after = {};
  const patch = {};
  const mutatedFields = [];

  for (const field of SEO_PATCH_FIELDS) {
    if (parameters[field] === undefined) continue;
    before[field] = blog[field];
    patch[field] = parameters[field];
    after[field] = parameters[field];
    mutatedFields.push(field);
  }

  const blogService = require('../blogService');
  await blogService.updateBlog(blog.id, patch);

  return { before, after, mutatedFields };
}

const updateBlockSchema = z
  .object({
    blog_id: z.coerce.number().int().positive(),
    block_id: z.string().trim().min(1),
    new_data: z.record(z.any()),
  })
  .strict();

async function executeUpdateBlock(blog, parameters) {
  const { block_id: blockId, new_data: newData } = parameters;

  const blocks = blog.content_blocks || [];
  const index = blocks.findIndex((b) => b.id === blockId);
  if (index === -1) {
    throw ApiError.badRequest(`Block "${blockId}" not found on blog #${blog.id}.`, { code: 'BLOCK_NOT_FOUND' });
  }

  const before = blocks[index].data;
  const nextBlocks = blocks.slice();
  nextBlocks[index] = { ...nextBlocks[index], data: newData };

  const blogService = require('../blogService');
  // 'strict': this block was written by the agent, not typed by a person, so an
  // internal link it invented is stripped exactly as it would be at generation
  // time rather than published as a 404. See blogService.updateBlog.
  const saved = await blogService.updateBlog(
    blog.id,
    { content_blocks: nextBlocks },
    { linkPolicy: 'strict' }
  );

  return {
    before,
    after: newData,
    mutatedFields: ['content_blocks'],
    scores: {
      seo_score: saved.seo_score,
      aeo_score: saved.aeo_score,
      geo_score: saved.geo_score,
      word_count: saved.word_count,
    },
  };
}

const EXECUTOR_REGISTRY = {
  'blog.update_seo_fields': {
    parametersSchema: updateSeoFieldsSchema,
    execute: executeUpdateSeoFields,
  },
  'blog.update_block': {
    parametersSchema: updateBlockSchema,
    execute: executeUpdateBlock,
  },
};

function getExecutor(actionType) {
  return EXECUTOR_REGISTRY[actionType] || null;
}

module.exports = { EXECUTOR_REGISTRY, getExecutor };
