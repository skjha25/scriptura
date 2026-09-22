'use strict';

/**
 * Zod schemas for the blog endpoints.
 *
 * Two things these schemas are load-bearing for beyond shape checking:
 *
 * 1. MASS-ASSIGNMENT DEFENCE. Zod objects strip unknown keys, and the write
 *    schemas below simply do not declare the server-owned columns — `id`,
 *    `total_views`, `seo_score`, `word_count`, `generation_status`,
 *    `generation_error`, `serp_rank_*`, `created_at`, `deleted_at`. A client that
 *    posts them has them silently dropped rather than overwriting a measured
 *    value with a claimed one.
 *
 * 2. BLOCK STRUCTURE. `content_blocks` is the editable source of truth for
 *    article content, so a malformed block list would corrupt both the editor
 *    and the derived `blog_content` HTML. The block schema below validates it
 *    structurally before anything is persisted.
 */

const { z } = require('zod');
const {
  BLOG_STATUS,
  BLOG_STATUS_BY_LABEL,
  ARTICLE_TYPES,
  READABILITY_LEVELS,
  BRAND_VOICE_SOURCE_TYPES,
  IMAGE_STYLES,
  LOGO_POSITIONS,
  BLOCK_TYPES,
  POINTS_OF_VIEW,
  IMAGE_COUNT_MIN,
  IMAGE_COUNT_MAX,
  OPTIMIZATION_PROFILES,
} = require('../constants');

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Trimmed string that treats '' as absent, so a cleared form field nulls the column. */
const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max, `must be at most ${max} characters.`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

/** 'YYYY-MM-DD'. Matches the DATEONLY columns without timezone drift. */
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD format.')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'must be a real calendar date.')
  .nullable()
  .optional();

/** Allows 'YYYY-MM-DD' or full ISO strings for DATETIME columns. */
const dateTimeString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/, 'must be a valid date or datetime string.')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be a real calendar date.')
  .nullable()
  .optional();

const keywordArray = z
  .array(z.string().trim().min(1).max(120))
  .max(20, 'at most 20 keywords.')
  .optional();

/**
 * A single editor block. `data` is intentionally a permissive record: each block
 * type has its own fields, the renderer already tolerates missing/extra ones,
 * and enumerating all ten shapes here would mean this file and the renderer
 * could disagree. What matters structurally is that `type` is known and `data`
 * is an object — that is what the renderer relies on.
 */
const blockSchema = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  type: z.enum(BLOCK_TYPES, {
    errorMap: () => ({ message: `type must be one of ${BLOCK_TYPES.join(', ')}.` }),
  }),
  data: z.record(z.unknown()).default({}),
});

/**
 * Bounded to keep a runaway client (or a runaway model) from posting a payload
 * that costs more to render than the request is worth. 500 blocks is far beyond
 * any real article.
 */
const contentBlocksSchema = z.array(blockSchema).max(500, 'at most 500 blocks.').optional();

const seoStructureSchema = z
  .object({
    h1: z.boolean().optional(),
    h2: z.boolean().optional(),
    h3: z.boolean().optional(),
    faq: z.boolean().optional(),
    tables: z.boolean().optional(),
    key_takeaways: z.boolean().optional(),
    quotes: z.boolean().optional(),
    lists: z.boolean().optional(),
    emphasis: z.boolean().optional(),
  })
  .optional();

const extraImagesSchema = z
  .array(
    z.object({
      url: z.string().trim().min(1).max(1000),
      alt_text: z.string().trim().max(500).optional().default(''),
      has_logo_overlay: z.boolean().optional().default(false),
      logo_position: z.enum(LOGO_POSITIONS).optional().default('none'),
    })
  )
  .max(IMAGE_COUNT_MAX - 1, `at most ${IMAGE_COUNT_MAX - 1} additional images.`)
  .optional();

const outlineSchema = z
  .array(
    z.object({
      level: z.coerce.number().int().min(2).max(4),
      text: z.string().trim().min(1).max(300),
    })
  )
  .max(100, 'at most 100 outline entries.')
  .optional();

/**
 * Accepts either the numeric TINYINT or its label ('draft', 'published', …), so
 * the API is pleasant to call by hand while still storing the existing numeric
 * column. Labels come from constants, so adding a status updates both.
 */
const blogStatusSchema = z
  .union([
    z.coerce.number().int(),
    z.enum(Object.keys(BLOG_STATUS_BY_LABEL)),
  ])
  .transform((value) =>
    typeof value === 'number' ? value : BLOG_STATUS_BY_LABEL[value]
  )
  .refine(
    (value) => Object.values(BLOG_STATUS).includes(value),
    `blog_status must be one of ${Object.values(BLOG_STATUS).join(', ')} or ${Object.keys(
      BLOG_STATUS_BY_LABEL
    ).join(', ')}.`
  );

// ---------------------------------------------------------------------------
// Write schemas
// ---------------------------------------------------------------------------

/** Fields a client may set. Shared by create and update. */
const writableFields = {
  blog_title: z.string().trim().min(1, 'blog_title is required.').max(255),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'slug may contain only lowercase letters, numbers and single hyphens.'
    )
    .max(255)
    .optional(),
  topic: optionalText(255),
  seo_keywords: optionalText(255),
  secondary_keywords: keywordArray,

  meta_title: optionalText(255),
  meta_description: optionalText(500),
  og_image: optionalText(1000),
  canonical_url: optionalText(1000),

  content_blocks: contentBlocksSchema,

  article_type: z.enum(ARTICLE_TYPES).nullable().optional(),
  tone_of_voice: optionalText(100),
  point_of_view: z.enum(POINTS_OF_VIEW).nullable().optional(),
  target_country: optionalText(100),
  language: z.string().trim().min(2).max(10).optional(),
  readability_level: z.enum(READABILITY_LEVELS).nullable().optional(),
  ai_content_cleaning: z.boolean().optional(),
  custom_prompt: optionalText(3000),

  brand_voice_source_type: z.enum(BRAND_VOICE_SOURCE_TYPES).nullable().optional(),
  brand_voice_source_ref: optionalText(1000),
  brand_voice_tone: optionalText(255),
  brand_voice_pov: optionalText(50),
  brand_voice_traits: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
  brand_voice_confirmed: z.boolean().optional(),

  include_images: z.boolean().optional(),
  image_count: z.coerce.number().int().min(IMAGE_COUNT_MIN).max(IMAGE_COUNT_MAX).optional(),
  image_style: z.enum(IMAGE_STYLES).nullable().optional(),
  logo_overlay: z.boolean().optional(),
  logo_position: z.enum(LOGO_POSITIONS).nullable().optional(),
  blog_picture: optionalText(500),
  extra_images: extraImagesSchema,

  seo_structure_config: seoStructureSchema,
  internal_linking: z.boolean().optional(),
  internal_link_targets: z
    .array(z.union([z.string().trim().min(1).max(255), z.coerce.number().int().positive()]))
    .max(50)
    .optional(),
  external_web_grounding: z.boolean().optional(),
  outline: outlineSchema,

  /**
   * Which preset drove (or should drive) generation config — 'seo' | 'aeo' |
   * 'geo' | 'balanced'. User-writable because it is a choice the wizard makes,
   * unlike aeo_score/geo_score/cluster_id, which stay server-owned: the former
   * two are measured from content, and cluster_id is assigned through the
   * cluster API so a cluster's membership stays consistent from one place.
   */
  optimization_profile: z.enum(Object.values(OPTIMIZATION_PROFILES)).nullable().optional(),

  blog_status: blogStatusSchema.optional(),
  published_by: optionalText(255),
  publish_date: dateTimeString,
  start_date: dateOnly,
  end_date: dateOnly,

  category: optionalText(100),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
};

/**
 * Rejects an end_date that precedes start_date. Applied to both create and
 * update; on update the check only fires when both are present in the payload,
 * because a partial patch has no view of the stored counterpart.
 */
function withDateOrderCheck(schema) {
  return schema.refine(
    (data) =>
      !data.start_date || !data.end_date || data.start_date <= data.end_date,
    { message: 'end_date must not be earlier than start_date.', path: ['end_date'] }
  );
}

const createBlogSchema = withDateOrderCheck(z.object(writableFields).strip());

/**
 * Update is the same field set, all optional, but must not be empty — an empty
 * PATCH is almost always a client bug, and reporting it beats silently
 * returning an unchanged record.
 */
const updateBlogSchema = withDateOrderCheck(
  z
    .object({ ...writableFields, blog_title: writableFields.blog_title.optional() })
    .strip()
    .refine((data) => Object.keys(data).length > 0, {
      message: 'Provide at least one field to update.',
    })
);

/**
 * Publishing takes no body by default. An optional publish_date allows
 * back-dating, and `scheduled` lets the same endpoint schedule instead of
 * publishing immediately.
 */
const publishBlogSchema = z.object({
  publish_date: dateTimeString,
  scheduled: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Read schemas
// ---------------------------------------------------------------------------

const idParamSchema = z.object({
  id: z.coerce
    .number({ invalid_type_error: 'id must be a number.' })
    .int('id must be an integer.')
    .positive('id must be positive.'),
});

const blockIdParamSchema = idParamSchema.extend({
  blockId: z.string().trim().min(1).max(64),
});

/** POST body for regenerating one image content block. The instruction is optional — empty means "regenerate with the existing context, no new direction." */
const regenerateBlockImageSchema = z.object({
  prompt: z.string().trim().max(500).optional(),
});

/** Columns a client may sort by. An allow-list, because this reaches ORDER BY. */
const SORTABLE_COLUMNS = Object.freeze([
  'created_at',
  'updated_at',
  'publish_date',
  'blog_title',
  'total_views',
  'seo_score',
  'word_count',
]);

const listBlogsSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  // Accepts a single value or a comma-separated list, so the UI can filter by
  // several statuses at once.
  status: z
    .string()
    .trim()
    .optional()
    .transform((value) => {
      if (!value) return undefined;
      return value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) =>
          /^\d+$/.test(part) ? Number(part) : BLOG_STATUS_BY_LABEL[part.toLowerCase()]
        )
        .filter((v) => v !== undefined);
    })
    .refine(
      (values) => values === undefined || values.every((v) => Object.values(BLOG_STATUS).includes(v)),
      'status contains an unrecognised value.'
    ),
  generation_status: z.string().trim().max(20).optional(),
  category: z.string().trim().max(100).optional(),
  /** Free-text search across title, topic and keywords. */
  q: z.string().trim().max(200).optional(),
  sort: z.enum(SORTABLE_COLUMNS).optional().default('created_at'),
  order: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.enum(['ASC', 'DESC']))
    .optional()
    .default('DESC'),
  /** Admin-only escape hatch to include soft-deleted rows. */
  include_deleted: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .optional()
    .transform((v) => v === true || v === 'true' || v === '1'),
});

/** Query for the internal-link picker: published blogs matching a search term. */
const linkableSearchSchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  /** Exclude the blog currently being edited so it cannot link to itself. */
  exclude_id: z.coerce.number().int().positive().optional(),
});

module.exports = {
  createBlogSchema,
  updateBlogSchema,
  publishBlogSchema,
  listBlogsSchema,
  linkableSearchSchema,
  idParamSchema,
  blockIdParamSchema,
  regenerateBlockImageSchema,
  blockSchema,
  contentBlocksSchema,
  blogStatusSchema,
  SORTABLE_COLUMNS,
};
