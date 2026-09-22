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

/**
 * House default image style — the fallback everywhere a style is not chosen.
 * Illustration, not photo: realistic photos of astrology topics came out
 * solemn and sad-looking on the live site.
 */
const DEFAULT_IMAGE_STYLE = 'illustration';

/**
 * Curated generation languages — offered in the wizard's language dropdown
 * and the per-cluster autopilot language setting. Order matters: it drives
 * both dropdowns' presentation. Mirrored in frontend/src/lib/constants.js and
 * asserted equal by src/lib/__tests__/constants.parity.test.js.
 */
const LANGUAGES = Object.freeze([
  'en',
  'hi',
  'gu',
  'mr',
  'ta',
  'te',
  'kn',
  'bn',
  'pa',
  'ml',
  'or',
  'ur',
]);

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

// ==========================================================================
// Keyword cluster enums
// ==========================================================================

/** Lifecycle states for a keyword cluster. */
const CLUSTER_STATUS = Object.freeze({
  PLANNING: 'planning',
  ACTIVE: 'active',
  COMPLETE: 'complete',
  PAUSED: 'paused',
});

/** Cluster structural types. */
const CLUSTER_TYPE = Object.freeze({
  PILLAR: 'pillar',
  HUB: 'hub',
});

/** Status of an individual keyword within a cluster. */
const CLUSTER_KEYWORD_STATUS = Object.freeze({
  PENDING: 'pending',
  SCHEDULED: 'scheduled',
  GENERATING: 'generating',
  GENERATED: 'generated',
  PUBLISHED: 'published',
  FAILED: 'failed',
});

/** Search intent taxonomy (extends the existing 3 in scriptura_keywords). */
const SEARCH_INTENT = Object.freeze({
  INFORMATIONAL: 'informational',
  COMMERCIAL: 'commercial',
  TRANSACTIONAL: 'transactional',
  NAVIGATIONAL: 'navigational',
});

// ==========================================================================
// Optimization profiles
// ==========================================================================

/**
 * Content optimization profiles — presets that configure generation behaviour.
 *
 *   seo      -> maximise traditional keyword coverage, headings, density
 *   aeo      -> maximise featured-snippet and AI-overview eligibility
 *   geo      -> maximise citation probability by ChatGPT / Perplexity / Gemini
 *   balanced -> equal weighting across all three (DEFAULT)
 */
const OPTIMIZATION_PROFILES = Object.freeze({
  SEO: 'seo',
  AEO: 'aeo',
  GEO: 'geo',
  BALANCED: 'balanced',
});

// ==========================================================================
// Settings scopes
// ==========================================================================

/** Scope levels for the KV settings table. */
const SETTINGS_SCOPE = Object.freeze({
  ORG: 'org',
  USER: 'user',
});

// ==========================================================================
// P6-A: Global content image defaults (ScripturaSettings key, scope:'org')
// ==========================================================================

/**
 * The one ScripturaSettings key that stores the global default output size
 * for every generated blog image (featured image today; block-level image
 * regeneration reuses the same services/imageGeneration.js#generateBlogImage
 * path once built, so it inherits this automatically). Deliberately
 * `scope:'org'` only — this is a property of the tenant's content/brand, not
 * a per-admin preference, and `'org'` is the scope that maps cleanly onto a
 * future `tenant_id` (see the P6 SaaS-readiness note).
 */
const IMAGE_DEFAULTS_SETTINGS_KEY = 'content.image_defaults';

/**
 * The real current behavior before any org has configured anything —
 * services/imageGeneration.js's own `DEFAULT_SIZE` ('1024x1024'), parsed to
 * numbers. This is what the Settings UI must show as "Current Default" until
 * an org explicitly saves something else — never a fabricated 1200x630.
 */
const IMAGE_DEFAULTS_FALLBACK = Object.freeze({ width: 1024, height: 1024, lockAspectRatio: true });

/** Sane bounds for a stored image dimension — generous enough for any real header-image use, tight enough to reject typos/abuse. */
const IMAGE_DIMENSION_MIN = 200;
const IMAGE_DIMENSION_MAX = 2048;

// ==========================================================================
// P6-B: Fact Verification (ScripturaSettings keys, scope:'org')
// ==========================================================================

/** One JSON array under this key holds every configured fact source — org-scoped only, same reasoning as IMAGE_DEFAULTS_SETTINGS_KEY. */
const FACT_SOURCES_SETTINGS_KEY = 'content.fact_sources';

/** How the verification step should treat multiple active sources. */
const FACT_VERIFICATION_POLICY_SETTINGS_KEY = 'content.fact_verification_policy';
const FACT_VERIFICATION_POLICIES = Object.freeze({
  PRIMARY_ONLY: 'primary_only',
  COMPARE_ALL: 'compare_all',
  PRIMARY_PLUS_CONFLICT_WARNING: 'primary_plus_conflict_warning',
});
const FACT_VERIFICATION_POLICY_DEFAULT = FACT_VERIFICATION_POLICIES.PRIMARY_ONLY;

/** Where a fact source's content comes from. */
const FACT_SOURCE_TYPES = Object.freeze({
  WEBSITE: 'website',
  PDF: 'pdf',
  DOCUMENT: 'document',
  REFERENCE_TEXT: 'reference_text',
});

const FACT_SOURCE_PRIORITIES = Object.freeze({
  PRIMARY: 'primary',
  SECONDARY: 'secondary',
});

/** File extensions a fact-source upload accepts. Only .txt/.docx get real text extraction (services/brandVoice.js#extractFromFile, reused as-is) — .pdf is stored but honestly marked unreadable; see services/factSources.js's own header comment for why no PDF parser is wired up. */
const FACT_SOURCE_UPLOAD_EXTENSIONS = Object.freeze(['.txt', '.docx', '.pdf']);

/** One article's worth of blocks is small; this just stops one pathological source from dominating the verification prompt. */
const FACT_SOURCE_MAX_EXCERPT_CHARS = 6000;

// ==========================================================================
// Activity log enums (scriptura_logs table)
// ==========================================================================

/** Event types tracked in the scriptura_logs table. */
const LOG_EVENT_TYPES = Object.freeze({
  GENERATION_QUEUED: 'generation_queued',
  GENERATION_STARTED: 'generation_started',
  GENERATION_COMPLETED: 'generation_completed',
  GENERATION_FAILED: 'generation_failed',
  AUTOPILOT_TRIGGERED: 'autopilot_triggered',
  AUTOPILOT_BLOG_CREATED: 'autopilot_blog_created',
  AUTOPILOT_SKIPPED: 'autopilot_skipped',
  AUTOPILOT_RETRY: 'autopilot_retry',
  SCHEDULED_PUBLISH: 'scheduled_publish',
  PUBLISH_SKIPPED: 'publish_skipped',
  REAP_STALE: 'reap_stale',
});

/** Log entry status (outcome indicator). */
const LOG_STATUS = Object.freeze({
  SUCCESS: 'success',
  FAILURE: 'failure',
  WARNING: 'warning',
  INFO: 'info',
});

/** Who/what triggered the log event. */
const LOG_TRIGGERED_BY = Object.freeze({
  USER: 'user',
  AUTOPILOT: 'autopilot',
  SCHEDULER: 'scheduler',
  SYSTEM: 'system',
});

/** The attribution string the existing production rows use. */
const DEFAULT_PUBLISHED_BY = 'DivineTalk Astrology';

/**
 * Our own site's identity — company name, alternate domain, and production
 * URLs — for agents that need to answer "what is our website" without the
 * admin having to explain what "DivineTalk" means. The primary domain is
 * deliberately NOT duplicated here: services/seoScore.js's INTERNAL_HOSTS is
 * already the authoritative source for that (used for internal-vs-external
 * link scoring and, since the SERP snapshot work, for "does our domain rank"
 * matching), so callers that need the primary domain read it from there.
 * Every value below is already used verbatim elsewhere in the codebase
 * (systemPrompts.js's "DivineTalk" persona line, ai/prompts.js's
 * cta_button URL) — this just names them once instead of leaving each one
 * implicit at its own call site.
 */
const SITE_IDENTITY = Object.freeze({
  company_name: 'DivineTalk',
  alternate_domains: Object.freeze(['divinetalk.in']),
  production_urls: Object.freeze(['https://divinetalk.in', 'https://divinetalk.in/astrology']),
});

// ==========================================================================
// Agentic AI enums (agent_activity table)
// ==========================================================================

/**
 * The chat agents an admin can talk to. Each name is both the tool-loop
 * persona key (see services/agents/registry.js) and the `:agentName` route
 * param on POST /agents/:agentName/chat.
 */
const AGENT_NAMES = Object.freeze({
  BLOG_IMAGE: 'blog_image_agent',
  GENERATE: 'generate_agent',
  CHIEF: 'chief_agent',
  SEO_ANALYST: 'seo_analyst_agent',
  BLOG_OPS: 'blog_ops_agent',
  CLUSTER: 'cluster_agent',
  RESEARCH: 'research_agent',
  AUTOPILOT: 'autopilot_agent',
});

/**
 * Event types recorded in agent_activity — one row per step of an agent's
 * tool-use loop, so a whole chat turn (and any delegation chain) is
 * reconstructable from `trace_id` alone.
 */
const AGENT_EVENT_TYPES = Object.freeze({
  USER_MESSAGE: 'user_message',
  DELEGATION: 'delegation',
  TOOL_CALL: 'tool_call',
  SETTING_PROPOSED: 'setting_proposed',
  SETTING_APPLIED: 'setting_applied',
  SETTING_REVERTED: 'setting_reverted',
  SETTING_DISMISSED: 'setting_dismissed',
  ERROR: 'error',
  FINAL_REPLY: 'final_reply',
  CHAT_CLEARED: 'chat_cleared',
});

/**
 * ScripturaSettings key for how many past user/assistant exchanges
 * services/agents/runAgentTurn.js replays into an agent's context on each
 * turn. Org-scoped only (an operational/cost knob, not a per-admin
 * preference) — shared between settings.controller.js (reads/writes it) and
 * runAgentTurn.js (reads it every turn) so the two can never drift on the
 * key name or bounds.
 */
const AGENT_CHAT_CONTEXT_EXCHANGES_KEY = 'agents.chat.context_exchanges';
const AGENT_CHAT_CONTEXT_EXCHANGES_DEFAULT = 10;
const AGENT_CHAT_CONTEXT_EXCHANGES_MIN = 2;
const AGENT_CHAT_CONTEXT_EXCHANGES_MAX = 30;

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
  DEFAULT_IMAGE_STYLE,
  LANGUAGES,
  LOGO_POSITIONS,
  BLOCK_TYPES,
  USER_ROLES,
  USER_ROLE_VALUES,
  POINTS_OF_VIEW,
  DEFAULT_SEO_STRUCTURE,
  IMAGE_COUNT_MIN,
  IMAGE_COUNT_MAX,
  DEFAULT_PUBLISHED_BY,
  SITE_IDENTITY,
  CLUSTER_STATUS,
  CLUSTER_TYPE,
  CLUSTER_KEYWORD_STATUS,
  SEARCH_INTENT,
  OPTIMIZATION_PROFILES,
  SETTINGS_SCOPE,
  LOG_EVENT_TYPES,
  LOG_STATUS,
  LOG_TRIGGERED_BY,
  AGENT_NAMES,
  AGENT_EVENT_TYPES,
  AGENT_CHAT_CONTEXT_EXCHANGES_KEY,
  AGENT_CHAT_CONTEXT_EXCHANGES_DEFAULT,
  AGENT_CHAT_CONTEXT_EXCHANGES_MIN,
  AGENT_CHAT_CONTEXT_EXCHANGES_MAX,
  IMAGE_DEFAULTS_SETTINGS_KEY,
  IMAGE_DEFAULTS_FALLBACK,
  IMAGE_DIMENSION_MIN,
  IMAGE_DIMENSION_MAX,
  FACT_SOURCES_SETTINGS_KEY,
  FACT_VERIFICATION_POLICY_SETTINGS_KEY,
  FACT_VERIFICATION_POLICIES,
  FACT_VERIFICATION_POLICY_DEFAULT,
  FACT_SOURCE_TYPES,
  FACT_SOURCE_PRIORITIES,
  FACT_SOURCE_UPLOAD_EXTENSIONS,
  FACT_SOURCE_MAX_EXCERPT_CHARS,
};
