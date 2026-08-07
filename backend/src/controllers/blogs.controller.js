'use strict';

/**
 * Blog CRUD, publishing, and the internal-link picker.
 *
 * Handlers stay thin: query construction and serialisation live in
 * src/services/blogService.js, and the `content_blocks` -> `blog_content`
 * derivation is enforced by a model hook so no handler here has to remember it.
 */

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { Blog } = require('../models');
const {
  serializeBlog,
  listBlogs,
  findLinkableBlogs,
  assertPublishable,
} = require('../services/blogService');
const {
  BLOG_STATUS,
  GENERATION_STATUS,
  DEFAULT_PUBLISHED_BY,
  DEFAULT_SEO_STRUCTURE,
  USER_ROLES,
} = require('../constants');

/**
 * GET /blogs
 * Paginated, filterable, searchable list. Excludes the rendered HTML column.
 */
const list = asyncHandler(async (req, res) => {
  const result = await listBlogs(req.query, { isAdmin: req.user.role === USER_ROLES.ADMIN });

  // Lets the frontend show a total without parsing the body, and is what the
  // CORS config exposes via exposedHeaders.
  res.set('X-Total-Count', String(result.pagination.total));
  res.json(result);
});

/**
 * GET /blogs/linkable
 * Published blogs matching a search term, for the wizard's internal-link picker.
 *
 * Registered before /:id in the router — otherwise Express would match
 * 'linkable' as an id and the coercion would 422.
 */
const linkable = asyncHandler(async (req, res) => {
  const data = await findLinkableBlogs(req.query);
  res.json({ data });
});

/**
 * GET /blogs/:id
 * Full record including content_blocks and the rendered HTML.
 */
const detail = asyncHandler(async (req, res) => {
  const blog = await Blog.findByPk(req.params.id);
  if (!blog) throw ApiError.notFound(`No blog with id ${req.params.id}.`);
  res.json({ data: serializeBlog(blog) });
});

/**
 * POST /blogs
 *
 * Creates a blog. This is the wizard's first save: it persists the configuration
 * before any generation runs, so a refresh mid-wizard loses nothing.
 *
 * Defaults applied here rather than in the schema because they depend on domain
 * knowledge (the Divinetalk attribution string, the standard SEO structure)
 * rather than on request validity.
 */
const create = asyncHandler(async (req, res) => {
  const payload = {
    // A new blog is always a draft whose content has not been generated. A
    // client that tries to create something already-published is overridden
    // rather than trusted — publishing goes through the publish endpoint, which
    // enforces the review gate.
    blog_status: BLOG_STATUS.DRAFT,
    generation_status: GENERATION_STATUS.DRAFT,
    published_by: DEFAULT_PUBLISHED_BY,
    seo_structure_config: DEFAULT_SEO_STRUCTURE,
    ...req.body,
  };

  // Even if the client asked for a published status in the body, force draft.
  payload.blog_status = BLOG_STATUS.DRAFT;
  payload.generation_status = GENERATION_STATUS.DRAFT;

  // Link keyword if present in keyword pool
  if (payload.seo_keywords) {
    const { ScripturaKeyword } = require('../models');
    const keyword = await ScripturaKeyword.findOne({
      where: {
        primary_keyword: payload.seo_keywords,
        status: 'in_progress',
      },
      order: [['created_at', 'DESC']],
    });
    if (keyword) {
      payload.keyword_pool_id = keyword.id;
    }
  }

  const blog = await Blog.create(payload);

  logger.info('Blog created', {
    blogId: Number(blog.id),
    slug: blog.slug,
    userId: req.user.id,
  });

  res.status(201).json({ data: serializeBlog(blog) });
});

/**
 * PATCH /blogs/:id
 *
 * Partial update. Sending `content_blocks` triggers the model hook that
 * regenerates `blog_content`, `word_count` and `seo_score`, which is how the
 * block editor's autosave keeps the rendered HTML in step.
 */
const update = asyncHandler(async (req, res) => {
  const blog = await Blog.findByPk(req.params.id);
  if (!blog) throw ApiError.notFound(`No blog with id ${req.params.id}.`);

  // Editing content while a generation run is writing to the same row would
  // have one overwrite the other. Refuse rather than race.
  if (blog.isGenerating() && req.body.content_blocks !== undefined) {
    throw ApiError.conflict(
      'Content is being generated for this blog right now. Wait for it to finish before editing.',
      { code: 'GENERATION_IN_PROGRESS' }
    );
  }

  blog.set(req.body);
  await blog.save();

  res.json({ data: serializeBlog(blog) });
});

/**
 * POST /blogs/:id/publish
 *
 * Publishes, or schedules when `scheduled` is true. Refuses when the blog has no
 * usable content — publishing an empty article puts a broken page on the public
 * site, and the wizard's review step exists precisely to prevent that.
 */
const publish = asyncHandler(async (req, res) => {
  const blog = await Blog.findByPk(req.params.id);
  if (!blog) throw ApiError.notFound(`No blog with id ${req.params.id}.`);

  const publishable = assertPublishable(blog);
  if (!publishable.ok) {
    throw ApiError.unprocessable(publishable.reason, { code: publishable.code });
  }

  const { publish_date: publishDate, scheduled } = req.body;

  if (scheduled) {
    if (!publishDate) {
      throw ApiError.unprocessable('publish_date is required when scheduling.', {
        code: 'PUBLISH_DATE_REQUIRED',
      });
    }
    blog.blog_status = BLOG_STATUS.SCHEDULED;
    blog.publish_date = publishDate;
  } else {
    blog.blog_status = BLOG_STATUS.PUBLISHED;
    // Resolved here rather than left to the model's beforeSave hook.
    //
    // The hook does fill a missing publish_date, but it runs *during* save —
    // after the start_date/end_date derivation below has already read the column.
    // Depending on it here left both dates null on any immediate publish of a
    // blog that had no date yet. The hook stays as the safety net for other
    // write paths; this handler no longer relies on it.
    blog.publish_date = publishDate || blog.publish_date || new Date().toISOString();
  }

  // Mirrors the existing production convention of a one-year content window.
  if (blog.publish_date && !blog.start_date) blog.start_date = blog.publish_date;
  if (blog.publish_date && !blog.end_date) {
    const end = new Date(`${blog.publish_date}T00:00:00Z`);
    end.setUTCFullYear(end.getUTCFullYear() + 1);
    blog.end_date = end.toISOString().slice(0, 10);
  }

  await blog.save();

  logger.info(scheduled ? 'Blog scheduled' : 'Blog published', {
    blogId: Number(blog.id),
    slug: blog.slug,
    publishDate: blog.publish_date,
    userId: req.user.id,
  });

  res.json({ data: serializeBlog(blog) });
});

/**
 * DELETE /blogs/:id
 *
 * Soft delete, via the existing `deleted_at` column. Nothing in this application
 * issues a hard DELETE — the live table is shared with other systems and a row
 * removed here would be unrecoverable for all of them.
 */
const remove = asyncHandler(async (req, res) => {
  const blog = await Blog.findByPk(req.params.id);
  if (!blog) throw ApiError.notFound(`No blog with id ${req.params.id}.`);

  if (blog.isGenerating()) {
    throw ApiError.conflict(
      'Content is being generated for this blog. Wait for it to finish before deleting.',
      { code: 'GENERATION_IN_PROGRESS' }
    );
  }

  await blog.destroy();

  logger.info('Blog soft-deleted', {
    blogId: Number(blog.id),
    slug: blog.slug,
    userId: req.user.id,
  });

  res.json({
    message: 'Blog moved to trash. An admin can restore it.',
    data: { id: Number(blog.id), deleted_at: blog.deleted_at },
  });
});

/**
 * POST /blogs/:id/restore
 *
 * Admin-only counterpart to the soft delete. Exists because a soft delete
 * without a restore path is just a slower hard delete.
 */
const restore = asyncHandler(async (req, res) => {
  const blog = await Blog.findByPk(req.params.id, { paranoid: false });
  if (!blog) throw ApiError.notFound(`No blog with id ${req.params.id}.`);

  if (!blog.deleted_at) {
    throw ApiError.conflict('That blog is not deleted.', { code: 'NOT_DELETED' });
  }

  await blog.restore();

  logger.info('Blog restored', { blogId: Number(blog.id), userId: req.user.id });

  res.json({ data: serializeBlog(blog) });
});

module.exports = { list, linkable, detail, create, update, publish, remove, restore };
