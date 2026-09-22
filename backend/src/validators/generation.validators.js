// backend/src/validators/generation.validators.js
'use strict';

/**
 * Zod schemas for the /generate endpoints and for the persisted generation config.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CONFIG SCHEMA LIVES HERE AND NOT IN THE SERVICE
 * ---------------------------------------------------------------------------
 * The same shape is validated in two places: at the HTTP boundary by
 * middleware/validate.js, and inside services/generation.js by
 * `validateGenerationConfig` (which a background job or a re-generate action can
 * reach without an HTTP request). One schema, two entry points — otherwise the
 * route and the service drift and the drift is only discovered in production.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FIELD NAMES ARE snake_case
 * ---------------------------------------------------------------------------
 * They match the `blogs` columns exactly. The full config object is persisted to
 * `blogs.generation_config` as an audit snapshot, so a stored config is directly
 * comparable to the row it produced. Renaming on the way in would mean a
 * translation table nobody maintains.
 */

const { z } = require('zod');

const {
  ARTICLE_TYPES,
  READABILITY_LEVELS,
  BRAND_VOICE_SOURCE_TYPES,
  POINTS_OF_VIEW,
  DEFAULT_SEO_STRUCTURE,
  IMAGE_COUNT_MIN,
  IMAGE_COUNT_MAX,
  IMAGE_STYLES,
  DEFAULT_IMAGE_STYLE,
  LANGUAGES,
  OPTIMIZATION_PROFILES,
} = require('../constants');

/** Article length bounds. Below 300 nothing ranks; above 4000 is two articles. */
const TARGET_WORD_COUNT_MIN = 300;
const TARGET_WORD_COUNT_MAX = 4000;
const TARGET_WORD_COUNT_DEFAULT = 1200;

/** Title suggestions per request. Five is what the wizard shows. */
const TITLE_COUNT_MIN = 1;
const TITLE_COUNT_MAX = 10;
const TITLE_COUNT_DEFAULT = 5;

/** A trimmed, non-empty string with a length ceiling. */
function text(max, label) {
  return z
    .string()
    .trim()
    .min(1, `${label} cannot be empty.`)
    .max(max, `${label} must be at most ${max} characters.`);
}

/** An optional trimmed string; '' is normalised to undefined, not kept. */
function optionalText(max) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? undefined : value))
    .optional();
}

/**
 * Keyword list.
 *
 * Deduplicated case-insensitively, because the SEO scorer counts distinct
 * secondary keywords and a list containing "Sawan Somwar" and "sawan somwar"
 * would make the coverage criterion unreachable.
 */
const keywordList = z
  .array(z.string().trim().min(1).max(255))
  .max(20, 'At most 20 secondary keywords.')
  .default([])
  .transform((list) => {
    const seen = new Set();
    return list.filter((keyword) => {
      const key = keyword.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

/**
 * The SEO structure toggles.
 *
 * Every key is optional and defaulted, so the wizard may send a partial object
 * (it does — the panel only sends what the user touched) and the pipeline still
 * receives a complete map.
 */
const seoStructureSchema = z
  .object({
    h1: z.boolean().default(DEFAULT_SEO_STRUCTURE.h1),
    h2: z.boolean().default(DEFAULT_SEO_STRUCTURE.h2),
    h3: z.boolean().default(DEFAULT_SEO_STRUCTURE.h3),
    faq: z.boolean().default(DEFAULT_SEO_STRUCTURE.faq),
    tables: z.boolean().default(DEFAULT_SEO_STRUCTURE.tables),
    key_takeaways: z.boolean().default(DEFAULT_SEO_STRUCTURE.key_takeaways),
    quotes: z.boolean().default(DEFAULT_SEO_STRUCTURE.quotes),
    lists: z.boolean().default(DEFAULT_SEO_STRUCTURE.lists),
    emphasis: z.boolean().default(DEFAULT_SEO_STRUCTURE.emphasis),
  })
  .strict()
  .default({});

/** One outline row, matching the `blogs.outline` element shape. */
const outlineSectionSchema = z.object({
  level: z.coerce.number().int().min(2).max(3).default(2),
  text: text(255, 'An outline heading'),
});

const outlineSchema = z.array(outlineSectionSchema).max(60, 'An outline may have at most 60 rows.');

/** Brand voice as the wizard supplies it — after the human has confirmed it. */
const brandVoiceSchema = z
  .object({
    source_type: z.enum(BRAND_VOICE_SOURCE_TYPES).default('none'),
    source_ref: optionalText(1000),
    tone: optionalText(255),
    pov: z.enum(POINTS_OF_VIEW).optional(),
    traits: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
    summary: optionalText(600),
    /**
     * The Section 4 Step 2 gate. Defaulted to false so that omitting it is
     * "not confirmed" — the safe reading. services/generation.js refuses to
     * start when a voice was supplied and this is not explicitly true.
     */
    confirmed: z.boolean().default(false),
  })
  .strict()
  .default({});

/**
 * The full generation configuration.
 *
 * `.strict()` matters here beyond tidiness: this object is persisted verbatim to
 * `generation_config`, so an unknown key would be stored forever and start
 * looking like a real setting to whoever reads the row next.
 */
const generationConfigSchema = z
  .object({
    topic: text(255, 'Topic'),
    title: optionalText(255),
    keyword: optionalText(255),
    secondary_keywords: keywordList,

    article_type: z.enum(ARTICLE_TYPES).default('general'),
    tone_of_voice: optionalText(100),
    point_of_view: z.enum(POINTS_OF_VIEW).optional(),
    readability_level: z.enum(READABILITY_LEVELS).default('8th_grade'),
    language: z.enum(LANGUAGES).default('en'),
    target_country: optionalText(100),
    target_word_count: z.coerce
      .number()
      .int()
      .min(TARGET_WORD_COUNT_MIN)
      .max(TARGET_WORD_COUNT_MAX)
      .default(TARGET_WORD_COUNT_DEFAULT),
    ai_content_cleaning: z.boolean().default(false),
    /**
     * Free-text instruction for THIS article only, given priority over
     * every other tone/style directive in the generation prompt — see
     * services/ai/prompts.js's articlePrompt.
     */
    custom_prompt: optionalText(3000),

    outline: outlineSchema.default([]),
    seo_structure_config: seoStructureSchema,

    internal_linking: z.boolean().default(false),
    /** Blog ids or slugs. Mixed on purpose: the picker sends ids, a hand-written config sends slugs. */
    internal_link_targets: z
      .array(z.union([z.coerce.number().int().positive(), z.string().trim().min(1).max(255)]))
      .max(20)
      .default([]),
    external_web_grounding: z.boolean().default(false),

    brand_voice: brandVoiceSchema,

    include_images: z.boolean().default(true),
    image_count: z.coerce.number().int().min(IMAGE_COUNT_MIN).max(IMAGE_COUNT_MAX).default(1),
    image_style: z.enum(IMAGE_STYLES).default(DEFAULT_IMAGE_STYLE),
    logo_overlay: z.boolean().default(false),
    logo_position: z.enum(['top_left', 'top_right', 'bottom_left', 'bottom_right', 'none']).default('none'),

    /**
     * Which score this run should lean on — read by prompts.js's articlePrompt
     * to add AEO/GEO-specific directives on top of the always-on SEO structure.
     * Defaults to 'balanced' so a config saved before this field existed (or a
     * hand-written one) still validates.
     */
    optimization_profile: z.enum(Object.values(OPTIMIZATION_PROFILES)).default('balanced'),

    meta_title: optionalText(255),
    meta_description: optionalText(500),
  })
  .strict();

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/** POST /generate/title */
const generateTitleBody = z
  .object({
    topic: text(255, 'Topic'),
    keyword: optionalText(255),
    secondary_keywords: keywordList,
    article_type: z.enum(ARTICLE_TYPES).default('general'),
    tone_of_voice: optionalText(100),
    point_of_view: z.enum(POINTS_OF_VIEW).optional(),
    readability_level: z.enum(READABILITY_LEVELS).default('8th_grade'),
    language: z.enum(LANGUAGES).default('en'),
    target_country: optionalText(100),
    count: z.coerce.number().int().min(TITLE_COUNT_MIN).max(TITLE_COUNT_MAX).default(TITLE_COUNT_DEFAULT),
    brand_voice: brandVoiceSchema,
    /** Optional: when present the suggestions are saved nowhere, only scored. */
    blog_id: z.coerce.number().int().positive().optional(),
  })
  .strict();

/** POST /generate/outline */
const generateOutlineBody = z
  .object({
    topic: text(255, 'Topic'),
    title: optionalText(255),
    keyword: optionalText(255),
    secondary_keywords: keywordList,
    article_type: z.enum(ARTICLE_TYPES).default('general'),
    tone_of_voice: optionalText(100),
    point_of_view: z.enum(POINTS_OF_VIEW).optional(),
    readability_level: z.enum(READABILITY_LEVELS).default('8th_grade'),
    language: z.enum(LANGUAGES).default('en'),
    target_country: optionalText(100),
    target_word_count: z.coerce
      .number()
      .int()
      .min(TARGET_WORD_COUNT_MIN)
      .max(TARGET_WORD_COUNT_MAX)
      .default(TARGET_WORD_COUNT_DEFAULT),
    seo_structure_config: seoStructureSchema,
    external_web_grounding: z.boolean().default(false),
    brand_voice: brandVoiceSchema,
    blog_id: z.coerce.number().int().positive().optional(),
  })
  .strict();

/**
 * POST /generate/article
 *
 * `blog_id` is required, unlike titles and outlines: an article run mutates a
 * row and drives the generation state machine, so there has to be a row to
 * drive. Titles and outlines are pure suggestions the wizard holds in memory.
 */
const generateArticleBody = z
  .object({
    blog_id: z.coerce.number().int().positive({ message: 'blog_id is required.' }),
    config: generationConfigSchema,
  })
  .strict();

/** GET /generate/status/:blogId — also serves /blogs/:id/generation-status. */
const generationStatusParams = z
  .object({
    blogId: z.coerce.number().int().positive().optional(),
    id: z.coerce.number().int().positive().optional(),
  })
  .refine((value) => value.blogId !== undefined || value.id !== undefined, {
    message: 'A blog id is required.',
  });

module.exports = {
  generationConfigSchema,
  seoStructureSchema,
  outlineSchema,
  outlineSectionSchema,
  brandVoiceSchema,
  keywordList,
  generateTitleBody,
  generateOutlineBody,
  generateArticleBody,
  generationStatusParams,
  TARGET_WORD_COUNT_MIN,
  TARGET_WORD_COUNT_MAX,
  TARGET_WORD_COUNT_DEFAULT,
  TITLE_COUNT_DEFAULT,
};
