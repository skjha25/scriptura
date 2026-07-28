'use strict';

/**
 * Domain enumerations.
 *
 * Single source of truth for every closed set of values in the app. The model,
 * the Zod validators, the seeders and the OpenAPI spec all read from here, so
 * adding a value is a one-line change that cannot leave one layer behind.
 *
 * The frontend mirrors these in frontend/src/lib/constants.js; a parity test
 * (tests/unit/constants-parity.test.js) fails if the two drift.
 */

/**
 * `blogs.blog_status` — TINYINT on the existing production table.
 *
 * 1 = published is CONFIRMED from live data (row 813 is a published post with
 * blog_status = 1). The remaining values are our own additions, chosen so that
 * every existing row keeps its current meaning and 0 is a safe default for
 * newly inserted drafts. Documented in ARCHITECTURE.md.
 */
const BLOG_STATUS = Object.freeze({
  DRAFT: 0,
  PUBLISHED: 1,
  SCHEDULED: 2,
  ARCHIVED: 3,
});

const BLOG_STATUS_LABELS = Object.freeze({
  [BLOG_STATUS.DRAFT]: 'draft',
  [BLOG_STATUS.PUBLISHED]: 'published',
  [BLOG_STATUS.SCHEDULED]: 'scheduled',
  [BLOG_STATUS.ARCHIVED]: 'archived',
});

/** Reverse lookup: 'published' -> 1. Used when a client filters by name. */
const BLOG_STATUS_BY_LABEL = Object.freeze(
  Object.entries(BLOG_STATUS_LABELS).reduce((acc, [value, label]) => {
    acc[label] = Number(value);
    return acc;
  }, {})
);

/**
 * `blogs.generation_status` — tracks the async AI pipeline for one blog row.
 *
 *   draft      -> created in the wizard, generation not started
 *   queued     -> generation accepted, worker has not picked it up
 *   generating -> a provider call is in flight
 *   generated  -> content written to content_blocks + blog_content, awaiting
 *                 human review in the block editor (never auto-published)
 *   failed     -> generation_error holds the reason; retryable
 */
const GENERATION_STATUS = Object.freeze({
  DRAFT: 'draft',
  QUEUED: 'queued',
  GENERATING: 'generating',
  GENERATED: 'generated',
  FAILED: 'failed',
});

/** States from which a new generation run may be started. */
const GENERATION_RETRYABLE_FROM = Object.freeze([
  GENERATION_STATUS.DRAFT,
  GENERATION_STATUS.GENERATED,
  GENERATION_STATUS.FAILED,
]);

/** States that mean a run is currently occupying the pipeline. */
const GENERATION_IN_FLIGHT = Object.freeze([
  GENERATION_STATUS.QUEUED,
  GENERATION_STATUS.GENERATING,
]);

const ARTICLE_TYPES = Object.freeze([
  'how_to',
  'listicle',
  'product_review',
  'comparison',
  'case_study',
  'general',
]);

const READABILITY_LEVELS = Object.freeze(['5th_grade', '8th_grade', 'college', 'none']);

const BRAND_VOICE_SOURCE_TYPES = Object.freeze(['text', 'web_scrape', 'file_upload', 'none']);

const IMAGE_STYLES = Object.freeze(['photo', 'illustration', 'minimal', 'brand_colored']);

const LOGO_POSITIONS = Object.freeze([
  'top_left',
  'top_right',
  'bottom_left',
  'bottom_right',
  'center',
  'none',
]);

/** Block types the visual editor can render. Order matters for the insert menu. */
const BLOCK_TYPES = Object.freeze([
  'heading',
  'paragraph',
  'image',
  'quote',
  'table',
  'faq_accordion',
  'cta_button',
  'list',
  'embed',
  'key_takeaway',
]);

const USER_ROLES = Object.freeze({
  ADMIN: 'admin',
  EDITOR: 'editor',
});

const USER_ROLE_VALUES = Object.freeze(Object.values(USER_ROLES));

/** Points of view offered in the wizard and inferred by brand-voice analysis. */
const POINTS_OF_VIEW = Object.freeze([
  'first_person_singular',
  'first_person_plural',
  'second_person',
  'third_person',
]);

/** Default SEO structure toggles applied when the wizard sends none. */
const DEFAULT_SEO_STRUCTURE = Object.freeze({
  h1: true,
  h2: true,
  h3: true,
  faq: true,
  tables: false,
  key_takeaways: true,
  quotes: false,
  lists: true,
  emphasis: true,
});

/** Image count bounds from Section 4 of the spec. */
const IMAGE_COUNT_MIN = 1;
const IMAGE_COUNT_MAX = 4;

/** The attribution string the existing production rows use. */
const DEFAULT_PUBLISHED_BY = 'DivineTalk Astrology';

module.exports = {
  BLOG_STATUS,
  BLOG_STATUS_LABELS,
  BLOG_STATUS_BY_LABEL,
  GENERATION_STATUS,
  GENERATION_RETRYABLE_FROM,
  GENERATION_IN_FLIGHT,
  ARTICLE_TYPES,
  READABILITY_LEVELS,
  BRAND_VOICE_SOURCE_TYPES,
  IMAGE_STYLES,
  LOGO_POSITIONS,
  BLOCK_TYPES,
  USER_ROLES,
  USER_ROLE_VALUES,
  POINTS_OF_VIEW,
  DEFAULT_SEO_STRUCTURE,
  IMAGE_COUNT_MIN,
  IMAGE_COUNT_MAX,
  DEFAULT_PUBLISHED_BY,
};
