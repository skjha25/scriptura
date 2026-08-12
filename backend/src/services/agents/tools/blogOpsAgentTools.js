'use strict';

/**
 * Tools available to the Blog Ops Agent.
 *
 * `find_blogs` mirrors blogService.listBlogs()'s filter surface (status,
 * category, generation_status, q, sort, order, page, limit) — this tool
 * bypasses the HTTP validator (validators/blog.validators.js's
 * `listBlogsSchema`) entirely, so it must replicate that schema's label->enum
 * coercion itself (status labels -> BLOG_STATUS numbers), not just its field
 * names, or a perfectly reasonable-looking call from the model would silently
 * match nothing.
 *
 * `get_current_blocks`/`propose_block_edit` are the Editor-page pair. Unlike
 * every other write-capable tool in this app, `propose_block_edit`'s Apply
 * never reaches the backend at all — the widget's `onApplyProposal` callback
 * (wired in EditorPage.js) calls `useBlockHistory`'s `setBlocks()` directly,
 * which already gives undo/redo and autosave for free. `revertible: false`
 * on the proposal is not "no undo exists" here, it's "undo already exists,
 * for free, as the editor's own Undo button" — a one-click Revert on the
 * chat card would be a confusing second, weaker mechanism next to it.
 */

const { BLOG_STATUS, BLOG_STATUS_BY_LABEL, GENERATION_STATUS } = require('../../../constants');

const SORTABLE_COLUMNS = ['created_at', 'updated_at', 'publish_date', 'blog_title', 'total_views', 'seo_score', 'word_count'];

/** Same label/number acceptance as listBlogsSchema, minus the HTTP-layer transform/refine ceremony. */
function coerceStatus(status) {
  if (!status) return undefined;
  const values = String(status)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : BLOG_STATUS_BY_LABEL[part.toLowerCase()]))
    .filter((v) => v !== undefined && Object.values(BLOG_STATUS).includes(v));
  return values.length ? values : undefined;
}

const findBlogs = {
  name: 'find_blogs',
  description:
    'Find blogs by status, category, generation status, and/or free-text search. Mirrors the filters ' +
    'on the All Blogs page exactly, so results match what the admin would see there.',
  input_schema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: `Comma-separated status label(s): ${Object.keys(BLOG_STATUS_BY_LABEL).join(', ')}.`,
      },
      generation_status: { type: 'string', enum: Object.values(GENERATION_STATUS) },
      category: { type: 'string' },
      q: { type: 'string', description: 'Free-text search across title, topic, and keywords.' },
      sort: { type: 'string', enum: SORTABLE_COLUMNS },
      order: { type: 'string', enum: ['ASC', 'DESC'] },
      page: { type: 'integer', minimum: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
  },
  async execute({ status, generation_status, category, q, sort, order, page, limit } = {}) {
    const blogService = require('../../blogService');
    const result = await blogService.listBlogs(
      {
        status: coerceStatus(status),
        generation_status,
        category,
        q,
        sort: SORTABLE_COLUMNS.includes(sort) ? sort : undefined,
        order: order === 'ASC' || order === 'DESC' ? order : undefined,
        page: Number.isInteger(page) && page > 0 ? page : 1,
        limit: Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 20,
      },
      { isAdmin: true }
    );
    return { type: 'read', blogs: result.data, pagination: result.pagination };
  },
};

const getCurrentBlocks = {
  name: 'get_current_blocks',
  description:
    'Read a blog\'s last-SAVED content blocks (id/type/data). This is a SNAPSHOT, not a live view — if ' +
    'the admin has been editing for a while in this same conversation, prefer the blocks already given ' +
    'to you as page context over calling this again, and say so if you are not sure which is current.',
  input_schema: {
    type: 'object',
    properties: {
      blog_id: { type: 'integer' },
    },
    required: ['blog_id'],
  },
  async execute({ blog_id } = {}) {
    const blogService = require('../../blogService');
    const blog = await blogService.findBlog(blog_id);
    if (!blog) throw new Error(`Blog #${blog_id} not found.`);
    return { type: 'read', blocks: blog.content_blocks || [] };
  },
};

const proposeBlockEdit = {
  name: 'propose_block_edit',
  description:
    'Propose new content for one specific block (by its id) in the current blog. Only proposes the ' +
    'diff for the admin to review; never writes it — the admin\'s own Undo button already covers ' +
    'reverting it once applied, so there is no separate revert action for this.',
  input_schema: {
    type: 'object',
    properties: {
      blog_id: { type: 'integer' },
      block_id: { type: 'string', description: 'The id of the block to edit, from the current blocks.' },
      new_data: {
        type: 'object',
        description: "The block's new `data` object, in the same shape as its current data (e.g. {text, html} for a paragraph).",
      },
    },
    required: ['blog_id', 'block_id', 'new_data'],
  },
  async execute({ blog_id, block_id, new_data } = {}) {
    if (!block_id) throw new Error('block_id is required.');
    if (!new_data || typeof new_data !== 'object') throw new Error('new_data must be an object.');

    let currentData = null;
    if (blog_id) {
      const blogService = require('../../blogService');
      const blog = await blogService.findBlog(blog_id);
      const block = (blog?.content_blocks || []).find((b) => b.id === block_id);
      currentData = block?.data || null;
    }

    return {
      type: 'proposed_change',
      change: {
        domain: 'blog_ops',
        action: 'update_block',
        key: 'update_block',
        block_id,
        current_value: currentData,
        proposed_value: new_data,
        revertible: false,
      },
      message: 'Proposed new content for that block — nothing has been applied yet. Use the editor\'s own Undo to revert once you do apply it.',
    };
  },
};

module.exports = {
  TOOLS: [findBlogs, getCurrentBlocks, proposeBlockEdit],
};
