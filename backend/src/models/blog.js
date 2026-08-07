'use strict';

/**
 * The `blogs` model — the single table this application reads and writes.
 *
 * Two things to know before editing:
 *
 * 1. EXISTING COLUMNS ARE CONTRACTUAL. Everything in the first block below
 *    already exists in Divinetalk production (the live table has rows up to at
 *    least id 813). Names and types must not change: other systems read this
 *    table. `blog_content` in particular stays the rendered HTML those systems
 *    already consume.
 *
 * 2. NEW COLUMNS ARE DENORMALISED ON PURPOSE. Brand voice, image config,
 *    generation config and SEO settings all live on the blog row rather than in
 *    `brand_voices` / `blog_images` / `generation_jobs` tables. That is an
 *    explicit MVP trade-off from the spec: one blog is one row, no joins, and
 *    the wizard's whole submission is auditable in place. The cost is that a
 *    brand voice cannot be reused across blogs without copying it.
 *    ARCHITECTURE.md documents the normalisation path if that becomes a real
 *    need.
 *
 * Source of truth for content: `content_blocks` (JSON) is what the editor
 * mutates. `blog_content` (HTML) is *derived* from it on every save by
 * services/blocksToHtml. Never hand-edit `blog_content` — it will be
 * overwritten on the next save.
 */

const { DataTypes } = require('sequelize');
const {
  BLOG_STATUS,
  BLOG_STATUS_LABELS,
  GENERATION_STATUS,
  ARTICLE_TYPES,
  READABILITY_LEVELS,
  BRAND_VOICE_SOURCE_TYPES,
  IMAGE_STYLES,
  LOGO_POSITIONS,
  IMAGE_COUNT_MIN,
  IMAGE_COUNT_MAX,
} = require('../constants');

/**
 * Normalising getter for JSON columns.
 *
 * MySQL's JSON type and SQLite's TEXT-backed emulation both normally hand back
 * parsed values, but a column that was written before it was JSON-typed, or
 * written by an external system as a JSON-encoded string, comes back as a
 * string. Parsing defensively here means callers can always assume the shape
 * and never have to guard. A malformed value degrades to the fallback rather
 * than throwing mid-request.
 *
 * @param {string} field Column name.
 * @param {'array'|'object'} kind Expected shape, used as the fallback.
 */
function jsonGetter(field, kind) {
  const fallback = () => (kind === 'array' ? [] : {});
  return function get() {
    const raw = this.getDataValue(field);
    if (raw === null || raw === undefined) return kind === 'array' ? [] : null;
    let value = raw;
    if (typeof raw === 'string') {
      try {
        value = JSON.parse(raw);
      } catch {
        return fallback();
      }
    }
    if (kind === 'array') return Array.isArray(value) ? value : fallback();
    return typeof value === 'object' && value !== null ? value : fallback();
  };
}

module.exports = (sequelize) => {
  const Blog = sequelize.define(
    'Blog',
    {
      // =======================================================================
      // EXISTING PRODUCTION COLUMNS — preserved exactly. Do not rename.
      // =======================================================================
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      blog_title: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
          notEmpty: { msg: 'blog_title cannot be empty.' },
          len: { args: [1, 255], msg: 'blog_title must be 1–255 characters.' },
        },
      },
      /**
       * Primary topic / seed keyword. Frequently empty in existing rows, which
       * is why it stays nullable — backfilling it is not this project's job.
       */
      topic: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      /**
       * Legacy primary keyword field. Kept as a plain string for compatibility
       * with whatever already reads it; additional keywords go to
       * `secondary_keywords` rather than being crammed in here.
       */
      seo_keywords: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      /**
       * Storage-relative path to the primary/cover image, matching the existing
       * convention: `blogs/July2026/<random>.png`. Not a URL — StorageService
       * resolves it to one at serialisation time so the same row works with the
       * local driver and with S3.
       */
      blog_picture: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      /**
       * Rendered article HTML, consumed by the public site. DERIVED from
       * content_blocks — see the file header.
       */
      blog_content: {
        type: DataTypes.TEXT('long'),
        allowNull: true,
      },
      blog_status: {
        type: DataTypes.TINYINT,
        allowNull: false,
        defaultValue: BLOG_STATUS.DRAFT,
        validate: {
          isIn: {
            args: [Object.values(BLOG_STATUS)],
            msg: `blog_status must be one of ${Object.values(BLOG_STATUS).join(', ')}.`,
          },
        },
      },
      published_by: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      publish_date: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      total_views: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      start_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      end_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },

      // =======================================================================
      // NEW: SEO / addressing
      // =======================================================================
      /**
       * URL slug derived from blog_title. Unique and indexed — it is the public
       * addressing key. Generated by the beforeValidate hook when absent.
       */
      // Uniqueness is declared once, in the `indexes` block below. Declaring it
      // here as well would have Sequelize emit two objects with the same name.
      slug: {
        type: DataTypes.STRING(255),
        allowNull: true,
        validate: {
          is: {
            args: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
            msg: 'slug may contain only lowercase letters, numbers and single hyphens.',
          },
        },
      },
      meta_title: { type: DataTypes.STRING(255), allowNull: true },
      /** Longer than the ~160 chars Google renders, so drafts are never truncated on save. */
      meta_description: { type: DataTypes.STRING(500), allowNull: true },
      og_image: { type: DataTypes.STRING(1000), allowNull: true },
      canonical_url: { type: DataTypes.STRING(1000), allowNull: true },
      /** Extra target keywords. `seo_keywords` remains the primary/legacy one. */
      secondary_keywords: {
        type: DataTypes.JSON,
        allowNull: true,
        get: jsonGetter('secondary_keywords', 'array'),
      },

      // =======================================================================
      // NEW: content
      // =======================================================================
      /**
       * Ordered block list — the editable source of truth. Each entry is
       * `{ id, type, data }` where `type` is one of constants.BLOCK_TYPES.
       * Validated structurally by validators/blocks.js before any write.
       */
      content_blocks: {
        type: DataTypes.JSON,
        allowNull: true,
        get: jsonGetter('content_blocks', 'array'),
      },
      article_type: {
        type: DataTypes.STRING(50),
        allowNull: true,
        validate: {
          isIn: { args: [ARTICLE_TYPES], msg: `article_type must be one of ${ARTICLE_TYPES.join(', ')}.` },
        },
      },
      tone_of_voice: { type: DataTypes.STRING(100), allowNull: true },
      point_of_view: { type: DataTypes.STRING(50), allowNull: true },
      target_country: { type: DataTypes.STRING(100), allowNull: true },
      language: { type: DataTypes.STRING(10), allowNull: true, defaultValue: 'en' },
      readability_level: {
        type: DataTypes.STRING(20),
        allowNull: true,
        validate: {
          isIn: {
            args: [READABILITY_LEVELS],
            msg: `readability_level must be one of ${READABILITY_LEVELS.join(', ')}.`,
          },
        },
      },
      /** The "humanize" post-pass toggle. */
      ai_content_cleaning: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      // =======================================================================
      // NEW: brand voice (denormalised per blog — see file header)
      // =======================================================================
      brand_voice_source_type: {
        type: DataTypes.STRING(20),
        allowNull: true,
        validate: {
          isIn: {
            args: [BRAND_VOICE_SOURCE_TYPES],
            msg: `brand_voice_source_type must be one of ${BRAND_VOICE_SOURCE_TYPES.join(', ')}.`,
          },
        },
      },
      /** The URL scraped or the filename uploaded, for provenance. */
      brand_voice_source_ref: { type: DataTypes.STRING(1000), allowNull: true },
      brand_voice_tone: { type: DataTypes.STRING(255), allowNull: true },
      brand_voice_pov: { type: DataTypes.STRING(50), allowNull: true },
      /** Free-form style rules, e.g. ["Always opens with a light joke"]. */
      brand_voice_traits: {
        type: DataTypes.JSON,
        allowNull: true,
        get: jsonGetter('brand_voice_traits', 'array'),
      },
      /**
       * Hard gate from Section 4 Step 2: a human must confirm or edit the
       * AI-derived voice before article generation may run. The generation
       * service refuses to start while this is false and a voice was supplied.
       */
      brand_voice_confirmed: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      // =======================================================================
      // NEW: images
      // =======================================================================
      include_images: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      image_count: {
        type: DataTypes.TINYINT,
        allowNull: false,
        defaultValue: 1,
        validate: {
          min: { args: [IMAGE_COUNT_MIN], msg: `image_count must be at least ${IMAGE_COUNT_MIN}.` },
          max: { args: [IMAGE_COUNT_MAX], msg: `image_count must be at most ${IMAGE_COUNT_MAX}.` },
        },
      },
      image_style: {
        type: DataTypes.STRING(30),
        allowNull: true,
        validate: {
          isIn: { args: [IMAGE_STYLES], msg: `image_style must be one of ${IMAGE_STYLES.join(', ')}.` },
        },
      },
      logo_overlay: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      logo_position: {
        type: DataTypes.STRING(20),
        allowNull: true,
        validate: {
          isIn: {
            args: [LOGO_POSITIONS],
            msg: `logo_position must be one of ${LOGO_POSITIONS.join(', ')}.`,
          },
        },
      },
      /**
       * Images beyond the primary `blog_picture`:
       * `[{ url, alt_text, has_logo_overlay, logo_position }]`.
       */
      extra_images: {
        type: DataTypes.JSON,
        allowNull: true,
        get: jsonGetter('extra_images', 'array'),
      },

      // =======================================================================
      // NEW: generation configuration
      // =======================================================================
      /** `{ h1, h2, h3, faq, tables, key_takeaways, quotes, lists, emphasis }`. */
      seo_structure_config: {
        type: DataTypes.JSON,
        allowNull: true,
        get: jsonGetter('seo_structure_config', 'object'),
      },
      internal_linking: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      /** Blog ids/slugs eligible for or used as internal links. */
      internal_link_targets: {
        type: DataTypes.JSON,
        allowNull: true,
        get: jsonGetter('internal_link_targets', 'array'),
      },
      /** The SerpAPI "connect to web" fact-grounding toggle. */
      external_web_grounding: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      /** `[{ level, text }]` — generated by Claude or built by hand. */
      outline: {
        type: DataTypes.JSON,
        allowNull: true,
        get: jsonGetter('outline', 'array'),
      },

      // =======================================================================
      // NEW: measurement
      // =======================================================================
      seo_score: {
        type: DataTypes.TINYINT,
        allowNull: true,
        validate: {
          min: { args: [0], msg: 'seo_score must be between 0 and 100.' },
          max: { args: [100], msg: 'seo_score must be between 0 and 100.' },
        },
      },
      /**
       * Answer Engine Optimization score (0-100) — featured snippet / AI
       * Overview readiness. Computed by services/aeoScore.js in the same
       * beforeSave hook that derives seo_score, and null under the same
       * empty-content convention.
       */
      aeo_score: {
        type: DataTypes.TINYINT.UNSIGNED,
        allowNull: true,
        validate: {
          min: { args: [0], msg: 'aeo_score must be between 0 and 100.' },
          max: { args: [100], msg: 'aeo_score must be between 0 and 100.' },
        },
      },
      aeo_score_breakdown: {
        type: DataTypes.JSON,
        allowNull: true,
        get: jsonGetter('aeo_score_breakdown', 'array'),
      },
      /**
       * Generative Engine Optimization score (0-100) — AI-chat citation
       * readiness (ChatGPT/Perplexity/Gemini). Computed by services/geoScore.js.
       */
      geo_score: {
        type: DataTypes.TINYINT.UNSIGNED,
        allowNull: true,
        validate: {
          min: { args: [0], msg: 'geo_score must be between 0 and 100.' },
          max: { args: [100], msg: 'geo_score must be between 0 and 100.' },
        },
      },
      geo_score_breakdown: {
        type: DataTypes.JSON,
        allowNull: true,
        get: jsonGetter('geo_score_breakdown', 'array'),
      },
      /** FK to keyword_clusters — which cluster this blog's keyword belongs to, if any. */
      cluster_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      /** Which optimisation preset drove generation config for this blog. */
      optimization_profile: {
        type: DataTypes.STRING(20),
        allowNull: true,
        defaultValue: 'balanced',
        validate: {
          isIn: {
            args: [['seo', 'aeo', 'geo', 'balanced']],
            msg: 'optimization_profile must be one of seo, aeo, geo, balanced.',
          },
        },
      },
      word_count: { type: DataTypes.INTEGER, allowNull: true },
      serp_rank_keyword: { type: DataTypes.STRING(255), allowNull: true },
      serp_rank_position: { type: DataTypes.INTEGER, allowNull: true },
      serp_rank_checked_at: { type: DataTypes.DATE, allowNull: true },

      // =======================================================================
      // NEW: generation state machine
      // =======================================================================
      generation_status: {
        type: DataTypes.STRING(20),
        allowNull: true,
        defaultValue: GENERATION_STATUS.DRAFT,
        validate: {
          isIn: {
            args: [Object.values(GENERATION_STATUS)],
            msg: `generation_status must be one of ${Object.values(GENERATION_STATUS).join(', ')}.`,
          },
        },
      },
      /** Full wizard submission snapshot, for audit and one-click re-generation. */
      generation_config: {
        type: DataTypes.JSON,
        allowNull: true,
        get: jsonGetter('generation_config', 'object'),
      },
      generation_error: { type: DataTypes.TEXT, allowNull: true },

      // =======================================================================
      // NEW: taxonomy
      // =======================================================================
      category: { type: DataTypes.STRING(100), allowNull: true },
      tags: {
        type: DataTypes.JSON,
        allowNull: true,
        get: jsonGetter('tags', 'array'),
      },
    },
    {
      tableName: 'blogs',
      // Soft delete via the existing deleted_at column: queries exclude deleted
      // rows automatically, and nothing in the app issues a hard DELETE.
      paranoid: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      deletedAt: 'deleted_at',
      underscored: true,
      freezeTableName: true,
      indexes: [
        // Required by Section 10. `slug` is the public lookup key; the other two
        // back the dashboard's status filter and date-ordered listings.
        { name: 'blogs_slug_unique', unique: true, fields: ['slug'] },
        { name: 'blogs_blog_status_idx', fields: ['blog_status'] },
        { name: 'blogs_publish_date_idx', fields: ['publish_date'] },
        // The list view's default ordering is "newest first, published only",
        // which this composite serves without a filesort.
        { name: 'blogs_status_publish_date_idx', fields: ['blog_status', 'publish_date'] },
        // The dashboard polls for in-flight generations.
        { name: 'blogs_generation_status_idx', fields: ['generation_status'] },
        // Backs the cluster detail view's "which blogs belong to this cluster" query.
        { name: 'blogs_cluster_id_idx', fields: ['cluster_id'] },
      ],
      scopes: {
        published: { where: { blog_status: BLOG_STATUS.PUBLISHED } },
        drafts: { where: { blog_status: BLOG_STATUS.DRAFT } },
        // Used by the internal-link picker: only real, linkable articles.
        linkable: {
          where: { blog_status: BLOG_STATUS.PUBLISHED },
          attributes: ['id', 'slug', 'blog_title', 'topic', 'seo_keywords', 'publish_date'],
        },
      },
    }
  );

  // =========================================================================
  // Hooks
  // =========================================================================

  /**
   * Generates a unique slug when one is missing.
   *
   * Lives on the model rather than in a service so that every write path —
   * controller, seeder-with-hooks, generation worker, future admin script —
   * gets a slug without having to remember to ask for one. Uniqueness is
   * resolved by appending `-2`, `-3`, … The unique index remains the real
   * guarantee: if two concurrent inserts pick the same suffix, one gets a
   * UniqueConstraintError, which the error handler turns into a clean 409.
   */
  Blog.addHook('beforeValidate', async (blog) => {
    if (blog.slug || !blog.blog_title) return;
    const { generateUniqueSlug } = require('../services/slug');
    blog.slug = await generateUniqueSlug(blog.blog_title, { excludeId: blog.id });
  });

  /**
   * Keeps `publish_date` consistent with a transition into the published state.
   * The dashboard's time-series charts group on this column, so a published row
   * without one would silently vanish from them.
   */
  Blog.addHook('beforeSave', (blog) => {
    const becamePublished =
      blog.changed('blog_status') && blog.blog_status === BLOG_STATUS.PUBLISHED;
    if (becamePublished && !blog.publish_date) {
      blog.publish_date = new Date().toISOString();
    }
  });

  /**
   * Regenerates the derived content columns whenever `content_blocks` changes.
   *
   * This is the mechanism that enforces the spec's central invariant:
   * `content_blocks` is the editable source of truth and `blog_content` (the
   * HTML the public site reads) is derived from it, so the two can never drift.
   *
   * It lives in a model hook rather than in a service on purpose — a hook cannot
   * be forgotten. Every write path (controller, generation worker, a future admin
   * script, a Sequelize `update()` with `individualHooks`) goes through it.
   *
   * `blog_content` is therefore effectively read-only from the API's point of
   * view: setting it directly is pointless, because this hook overwrites it from
   * the blocks on the same save.
   */
  Blog.addHook('beforeSave', (blog) => {
    if (!blog.changed('content_blocks')) return;

    // Required lazily: these services sit above the model layer, and a
    // top-level require would create an import cycle through models/index.js.
    const { blocksToHtml, countWords } = require('../services/blocksToHtml');

    const blocks = blog.content_blocks;
    blog.blog_content = blocks.length > 0 ? blocksToHtml(blocks) : null;
    blog.word_count = blocks.length > 0 ? countWords(blocks) : null;

    // An empty article has no score, rather than a very low one. A configured-
    // but-ungenerated draft scoring ~26 would drag the dashboard's average down
    // and misrepresent the quality of what is actually published — the analytics
    // layer averages over non-null scores precisely so drafts stay out of it.
    if (blocks.length === 0) {
      blog.seo_score = null;
      return;
    }

    // Re-score on content change so the dashboard never shows a score that
    // belongs to an older revision. Wrapped because a scoring bug must not be
    // able to block a save — the previous score is kept and the next save
    // retries.
    try {
      const { scoreArticle } = require('../services/seoScore');
      const { score } = scoreArticle({
        title: blog.blog_title,
        blocks,
        keyword: blog.seo_keywords || blog.topic || '',
        secondaryKeywords: blog.secondary_keywords,
        metaDescription: blog.meta_description,
      });
      if (Number.isFinite(score)) blog.seo_score = score;
    } catch (err) {
      require('../utils/logger').warn('SEO re-scoring skipped on save', {
        blogId: blog.id,
        error: err.message,
      });
    }

    // AEO (Answer Engine Optimization) — snippet/AI-Overview readiness.
    // Same null-on-empty-blocks convention as seo_score: an unconfigured draft
    // should not drag the dashboard average down.
    try {
      const { scoreArticle: scoreAeo } = require('../services/aeoScore');
      const { score: aeoScore, breakdown: aeoBreakdown } = scoreAeo({
        blocks,
        metaDescription: blog.meta_description,
        publishedBy: blog.published_by,
        updatedAt: blog.updated_at || new Date(),
      });
      blog.aeo_score = Number.isFinite(aeoScore) ? aeoScore : null;
      blog.aeo_score_breakdown = Number.isFinite(aeoScore) ? aeoBreakdown : null;
    } catch (err) {
      require('../utils/logger').warn('AEO re-scoring skipped on save', {
        blogId: blog.id,
        error: err.message,
      });
    }

    // GEO (Generative Engine Optimization) — AI-chat citation readiness.
    try {
      const { scoreArticle: scoreGeo } = require('../services/geoScore');
      const { score: geoScore, breakdown: geoBreakdown } = scoreGeo({ blocks });
      blog.geo_score = Number.isFinite(geoScore) ? geoScore : null;
      blog.geo_score_breakdown = Number.isFinite(geoScore) ? geoBreakdown : null;
    } catch (err) {
      require('../utils/logger').warn('GEO re-scoring skipped on save', {
        blogId: blog.id,
        error: err.message,
      });
    }
  });

  // =========================================================================
  // Instance helpers
  // =========================================================================

  /** 'draft' | 'published' | 'scheduled' | 'archived'. */
  Blog.prototype.statusLabel = function statusLabel() {
    return BLOG_STATUS_LABELS[this.blog_status] || 'unknown';
  };

  Blog.prototype.isPublished = function isPublished() {
    return this.blog_status === BLOG_STATUS.PUBLISHED;
  };

  /** True while an AI generation run is queued or executing. */
  Blog.prototype.isGenerating = function isGenerating() {
    return (
      this.generation_status === GENERATION_STATUS.QUEUED ||
      this.generation_status === GENERATION_STATUS.GENERATING
    );
  };

  return Blog;
};
