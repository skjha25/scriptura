'use strict';

/**
 * Blog query building and serialisation.
 *
 * The controller stays thin; the list-query construction and the API
 * representation live here because both are used from more than one place
 * (list, detail, analytics, the internal-link picker) and both are worth
 * testing directly.
 */

const { Op } = require('sequelize');
const config = require('../config');
const { Blog } = require('../models');
const {
  BLOG_STATUS,
  BLOG_STATUS_LABELS,
  GENERATION_STATUS,
} = require('../constants');

/**
 * Resolves a stored storage-relative path to a public URL.
 *
 * Delegated to StorageService so the same database row works under the local
 * driver and under S3 — the column holds a path, never a URL. Required lazily
 * because the storage module reads config at load time and this module is
 * imported by validators and tests that do not need it.
 *
 * @param {string|null} relativePath
 * @returns {string|null}
 */
function publicUrlFor(relativePath) {
  if (!relativePath) return null;
  // Already absolute (a legacy row, or an externally hosted image) — pass through.
  if (/^https?:\/\//i.test(relativePath)) return relativePath;
  const { toPublicUrl } = require('./storage');
  return toPublicUrl(relativePath);
}

/**
 * Normalises `undefined` to `null`.
 *
 * Immediately after `Model.create()`, Sequelize leaves nullable columns that were
 * never assigned as `undefined` rather than `null`. `JSON.stringify` drops
 * `undefined` keys, so POST /blogs would answer without `word_count` while
 * GET /blogs/:id answers with `word_count: null` — the same resource in two
 * shapes, which forces every client to handle both. Normalising here keeps one
 * contract without spending a reload query after every write.
 *
 * @param {*} value
 * @returns {*} `null` when the input is undefined, otherwise the input.
 */
function nullish(value) {
  return value === undefined ? null : value;
}

/**
 * Builds a LIKE pattern for a free-text search term.
 *
 * `%` and `_` are LIKE metacharacters. They cannot be escaped portably: MySQL
 * treats a backslash as the escape character by default, SQLite has no default
 * escape character at all and requires an explicit `ESCAPE` clause that
 * Sequelize's operator API does not expose. Escaping with a backslash therefore
 * works in production and silently fails in the test suite — the exact
 * divergence a portable suite is supposed to rule out.
 *
 * So the metacharacters are stripped rather than escaped. Behaviour is then
 * identical on both dialects and predictable: searching `100%` searches for
 * `100`. The characters are not searchable, which for blog titles and keywords
 * costs nothing real.
 *
 * @param {string} term
 * @returns {string|null} The pattern, or null when the term has no searchable
 *   content left — in which case the caller should skip the filter entirely
 *   rather than apply `%%`, which would match every row.
 */
function buildSearchPattern(term) {
  if (typeof term !== 'string') return null;
  const stripped = term.replace(/[\\%_]/g, '').trim();
  if (stripped === '') return null;
  return `%${stripped}%`;
}

/**
 * Converts a Blog instance into the API representation.
 *
 * Notable choices:
 *   - `id` is coerced to Number. It is a BIGINT, which the mysql2 driver may
 *     return as a string; leaving that inconsistency to reach the frontend
 *     causes `===` comparison bugs in React keys and route params.
 *   - `blog_status` is returned as both the raw TINYINT and a label, so clients
 *     can display without duplicating the mapping.
 *   - Image paths are returned raw *and* as resolved URLs. The raw value is what
 *     a client must send back on update; the URL is what it renders.
 *   - `blog_content` (the derived HTML) is omitted from list responses. It is the
 *     largest column by far and a 20-item page would otherwise ship megabytes.
 *
 * @param {import('sequelize').Model} blog
 * @param {object} [options]
 * @param {boolean} [options.includeContent=true] Include the rendered HTML and blocks.
 * @returns {object}
 */
function serializeBlog(blog, { includeContent = true } = {}) {
  if (!blog) return null;

  const base = {
    id: Number(blog.id),
    blog_title: blog.blog_title,
    slug: blog.slug,
    topic: blog.topic,
    seo_keywords: blog.seo_keywords,
    secondary_keywords: blog.secondary_keywords,

    blog_status: blog.blog_status,
    blog_status_label: BLOG_STATUS_LABELS[blog.blog_status] || 'unknown',
    generation_status: blog.generation_status,
    generation_error: blog.generation_error,

    meta_title: blog.meta_title,
    meta_description: blog.meta_description,
    canonical_url: blog.canonical_url,
    og_image: blog.og_image,
    og_image_url: publicUrlFor(blog.og_image),

    blog_picture: blog.blog_picture,
    blog_picture_url: publicUrlFor(blog.blog_picture),
    extra_images: (blog.extra_images || []).map((image) => ({
      ...image,
      url_resolved: publicUrlFor(image.url),
    })),

    article_type: blog.article_type,
    tone_of_voice: blog.tone_of_voice,
    point_of_view: blog.point_of_view,
    target_country: blog.target_country,
    language: blog.language,
    readability_level: blog.readability_level,
    ai_content_cleaning: blog.ai_content_cleaning,

    brand_voice: {
      source_type: blog.brand_voice_source_type,
      source_ref: blog.brand_voice_source_ref,
      tone: blog.brand_voice_tone,
      pov: blog.brand_voice_pov,
      traits: blog.brand_voice_traits,
      confirmed: blog.brand_voice_confirmed,
    },

    images_config: {
      include_images: blog.include_images,
      image_count: blog.image_count,
      image_style: blog.image_style,
      logo_overlay: blog.logo_overlay,
      logo_position: blog.logo_position,
    },

    seo_structure_config: blog.seo_structure_config,
    internal_linking: blog.internal_linking,
    internal_link_targets: blog.internal_link_targets,
    external_web_grounding: blog.external_web_grounding,
    outline: blog.outline,

    seo_score: blog.seo_score,
    word_count: blog.word_count,
    total_views: blog.total_views,

    serp: {
      keyword: blog.serp_rank_keyword,
      position: blog.serp_rank_position,
      checked_at: blog.serp_rank_checked_at,
      // Tells the UI whether a "check rank" action is even available, rather
      // than offering a button that would 503.
      available: config.serp.enabled,
    },

    category: blog.category,
    tags: blog.tags,

    published_by: blog.published_by,
    publish_date: blog.publish_date,
    start_date: blog.start_date,
    end_date: blog.end_date,

    created_at: blog.created_at,
    updated_at: blog.updated_at,
    deleted_at: blog.deleted_at,
  };

  if (includeContent) {
    base.content_blocks = blog.content_blocks;
    base.blog_content = blog.blog_content;
  }

  // One pass, rather than wrapping forty fields individually, so a field added
  // above cannot be forgotten. See nullish() for why this matters: without it,
  // POST and GET return the same resource in two different shapes.
  return normalizeUndefined(base);
}

/**
 * Recursively replaces `undefined` with `null` in a plain response object.
 *
 * Depth is bounded — the serialised shape is two levels deep (`brand_voice`,
 * `images_config`, `serp`, `extra_images`) — so recursion is safe here and there
 * is no cyclic structure to guard against.
 *
 * @param {object|Array} value
 * @returns {object|Array} The same structure with no `undefined` leaves.
 */
function normalizeUndefined(value) {
  if (Array.isArray(value)) return value.map(normalizeUndefined);
  if (value === null || typeof value !== 'object') return nullish(value);
  // Dates and other class instances must pass through untouched.
  if (value instanceof Date) return value;

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] =
      item !== null && typeof item === 'object' && !(item instanceof Date)
        ? normalizeUndefined(item)
        : nullish(item);
  }
  return out;
}

/** Compact shape for the internal-link picker and analytics lists. */
function serializeBlogSummary(blog) {
  return {
    id: Number(blog.id),
    blog_title: blog.blog_title,
    slug: blog.slug,
    topic: blog.topic,
    seo_keywords: blog.seo_keywords,
    publish_date: blog.publish_date,
    blog_status: blog.blog_status,
    blog_status_label: BLOG_STATUS_LABELS[blog.blog_status] || 'unknown',
  };
}

/**
 * Builds the Sequelize options for a filtered, paginated list request.
 *
 * @param {object} query Output of listBlogsSchema — already coerced and bounded.
 * @param {object} [options]
 * @param {boolean} [options.isAdmin=false] Gates `include_deleted`.
 * @returns {{where: object, order: Array, limit: number, offset: number, paranoid: boolean}}
 */
function buildListQuery(query, { isAdmin = false } = {}) {
  const where = {};

  if (query.status && query.status.length > 0) {
    where.blog_status = query.status.length === 1 ? query.status[0] : { [Op.in]: query.status };
  }

  if (query.generation_status) {
    where.generation_status = query.generation_status;
  }

  if (query.category) {
    where.category = query.category;
  }

  const pattern = buildSearchPattern(query.q);
  if (pattern) {
    // Search title, topic and the legacy keyword column together, which is what
    // "search by title/keyword" in the spec means in practice.
    //
    // Case handling: MySQL's default collation is case-insensitive but SQLite's
    // LIKE is only case-insensitive for ASCII. Rather than depend on either, the
    // term is matched with LIKE and the pattern's wildcards are the only
    // metacharacters — user-supplied % and _ are escaped below so a search for
    // "100%" does not become a match-everything query.
    where[Op.or] = [
      { blog_title: { [Op.like]: pattern } },
      { topic: { [Op.like]: pattern } },
      { seo_keywords: { [Op.like]: pattern } },
    ];
  }

  const limit = query.limit || config.pagination.defaultLimit;
  const page = query.page || 1;

  // Secondary sort on id keeps pagination stable when the primary key ties —
  // without it, two rows sharing a created_at can swap between pages.
  const order = [
    [query.sort || 'created_at', query.order || 'DESC'],
    ['id', 'DESC'],
  ];

  return {
    where,
    order,
    limit,
    offset: (page - 1) * limit,
    // Soft-deleted rows stay hidden unless an admin explicitly asks.
    paranoid: !(query.include_deleted && isAdmin),
  };
}

/**
 * Runs a paginated list query and returns rows plus pagination metadata.
 *
 * `findAndCountAll` is used rather than two queries so the count and the page
 * cannot disagree under concurrent writes.
 */
async function listBlogs(query, { isAdmin = false } = {}) {
  const options = buildListQuery(query, { isAdmin });

  const { rows, count } = await Blog.findAndCountAll({
    ...options,
    // The heaviest columns are excluded from list responses; the detail endpoint
    // returns them.
    attributes: { exclude: ['blog_content'] },
  });

  const limit = options.limit;
  const page = query.page || 1;

  return {
    data: rows.map((row) => serializeBlog(row, { includeContent: false })),
    pagination: {
      page,
      limit,
      total: count,
      total_pages: Math.max(1, Math.ceil(count / limit)),
      has_next: page * limit < count,
      has_prev: page > 1,
    },
  };
}

/**
 * Finds published blogs suitable as internal-link targets.
 *
 * Only published articles are offered: linking to a draft would emit a dead link
 * on the public site.
 */
async function findLinkableBlogs({ q, limit = 20, exclude_id: excludeId }) {
  const where = { blog_status: BLOG_STATUS.PUBLISHED };

  if (excludeId) {
    // A blog must not be offered as a link target for itself.
    where.id = { [Op.ne]: excludeId };
  }

  const pattern = buildSearchPattern(q);
  if (pattern) {
    where[Op.or] = [
      { blog_title: { [Op.like]: pattern } },
      { topic: { [Op.like]: pattern } },
      { seo_keywords: { [Op.like]: pattern } },
    ];
  }

  const rows = await Blog.findAll({
    where,
    attributes: ['id', 'slug', 'blog_title', 'topic', 'seo_keywords', 'publish_date', 'blog_status'],
    order: [['publish_date', 'DESC'], ['id', 'DESC']],
    limit,
  });

  return rows.map(serializeBlogSummary);
}

/**
 * Loads a blog by numeric id or by slug.
 *
 * Accepting both means the public site can fetch by slug while the editor uses
 * ids, without a second endpoint.
 *
 * @param {string|number} idOrSlug
 * @param {object} [options]
 * @param {boolean} [options.paranoid=true] false includes soft-deleted rows.
 */
async function findBlog(idOrSlug, { paranoid = true } = {}) {
  const asNumber = Number(idOrSlug);
  const where = Number.isInteger(asNumber) && asNumber > 0 ? { id: asNumber } : { slug: String(idOrSlug) };
  return Blog.findOne({ where, paranoid });
}

/**
 * True when the blog is in a state where publishing makes sense.
 *
 * Publishing an article whose generation failed, or that has no content at all,
 * would put an empty page on the public site — so the endpoint refuses and says
 * why.
 *
 * @returns {{ok: true}|{ok: false, reason: string, code: string}}
 */
function assertPublishable(blog) {
  if (blog.isGenerating()) {
    return {
      ok: false,
      code: 'GENERATION_IN_PROGRESS',
      reason: 'Content is still being generated. Wait for it to finish before publishing.',
    };
  }
  if (blog.generation_status === GENERATION_STATUS.FAILED) {
    return {
      ok: false,
      code: 'GENERATION_FAILED',
      reason: 'The last generation run failed. Retry generation or add content manually first.',
    };
  }
  const blocks = blog.content_blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return {
      ok: false,
      code: 'NO_CONTENT',
      reason: 'This blog has no content blocks. Add content before publishing.',
    };
  }
  if (!blog.blog_content || blog.blog_content.trim() === '') {
    return {
      ok: false,
      code: 'NO_RENDERED_CONTENT',
      reason: 'The blocks produced no renderable content. Check the block contents.',
    };
  }
  return { ok: true };
}

module.exports = {
  serializeBlog,
  serializeBlogSummary,
  buildListQuery,
  listBlogs,
  findLinkableBlogs,
  findBlog,
  assertPublishable,
  publicUrlFor,
};
