'use strict';

/**
 * Creates the `blogs` table.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * This creates a STANDALONE `blogs` table containing the existing production
 * columns *plus* the new AI/editor/SEO columns. It is meant to be run against a
 * fresh development database. It does NOT touch the live Divinetalk table.
 *
 * The live table already exists with the first block of columns below and has
 * real rows in it. When this build is finalised and you are ready to adopt it in
 * production, do NOT run this migration there — it would fail on an existing
 * table. Use the reviewable, reversible ALTER script instead:
 *
 *     backend/scripts/prod-adoption/001-add-ai-columns.sql
 *
 * and follow the runbook in ARCHITECTURE.md ("Adopting the schema in
 * production"). That script adds only the new columns and is idempotent.
 *
 * ---------------------------------------------------------------------------
 * CONSTRAINTS ON EDITING THIS FILE
 * ---------------------------------------------------------------------------
 *   - Column names/types in the "EXISTING" block are contractual. Other systems
 *     read this table; renaming or retyping them is a breaking change.
 *   - Portable DataTypes and queryInterface calls only, no raw SQL. The parity
 *     test (tests/unit/migration-parity.test.js) executes this file against
 *     in-memory SQLite and diffs the resulting schema against src/models, which
 *     is what guarantees the migration and the model can never drift.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'blogs',
      {
        // ===================================================================
        // EXISTING PRODUCTION COLUMNS — preserved exactly. Do not rename.
        // ===================================================================
        id: {
          type: Sequelize.BIGINT.UNSIGNED,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },
        blog_title: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        topic: {
          type: Sequelize.STRING(255),
          allowNull: true,
          comment: 'Primary topic / seed keyword. Often empty in legacy rows.',
        },
        seo_keywords: {
          type: Sequelize.STRING(255),
          allowNull: true,
          comment: 'Legacy primary keyword. Additional keywords go to secondary_keywords.',
        },
        blog_picture: {
          type: Sequelize.STRING(500),
          allowNull: true,
          comment: 'Storage-relative path, e.g. blogs/July2026/xxxx.png. Not a URL.',
        },
        blog_content: {
          type: Sequelize.TEXT('long'),
          allowNull: true,
          comment: 'Rendered article HTML. DERIVED from content_blocks on every save.',
        },
        blog_status: {
          type: Sequelize.TINYINT,
          allowNull: false,
          defaultValue: 0,
          comment: '0=draft, 1=published (confirmed from live data), 2=scheduled, 3=archived',
        },
        published_by: {
          type: Sequelize.STRING(255),
          allowNull: true,
          comment: 'Free-text attribution, e.g. "DivineTalk Astrology". Not a foreign key.',
        },
        publish_date: {
          type: Sequelize.DATEONLY,
          allowNull: true,
        },
        total_views: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        start_date: {
          type: Sequelize.DATEONLY,
          allowNull: true,
        },
        end_date: {
          type: Sequelize.DATEONLY,
          allowNull: true,
        },

        // ===================================================================
        // NEW — SEO / addressing
        // ===================================================================
        slug: {
          type: Sequelize.STRING(255),
          allowNull: true,
          comment: 'URL slug generated from blog_title. Unique, indexed.',
        },
        meta_title: { type: Sequelize.STRING(255), allowNull: true },
        meta_description: { type: Sequelize.STRING(500), allowNull: true },
        og_image: { type: Sequelize.STRING(1000), allowNull: true },
        canonical_url: { type: Sequelize.STRING(1000), allowNull: true },
        secondary_keywords: {
          type: Sequelize.JSON,
          allowNull: true,
          comment: 'Array of extra target keywords.',
        },

        // ===================================================================
        // NEW — content
        // ===================================================================
        content_blocks: {
          type: Sequelize.JSON,
          allowNull: true,
          comment: 'Ordered [{id,type,data}] block list. The editable source of truth.',
        },
        article_type: {
          type: Sequelize.STRING(50),
          allowNull: true,
          comment: 'how_to | listicle | product_review | comparison | case_study | general',
        },
        tone_of_voice: { type: Sequelize.STRING(100), allowNull: true },
        point_of_view: { type: Sequelize.STRING(50), allowNull: true },
        target_country: { type: Sequelize.STRING(100), allowNull: true },
        language: {
          type: Sequelize.STRING(10),
          allowNull: true,
          defaultValue: 'en',
        },
        readability_level: {
          type: Sequelize.STRING(20),
          allowNull: true,
          comment: '5th_grade | 8th_grade | college | none',
        },
        ai_content_cleaning: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
          comment: 'The "humanize" post-pass toggle.',
        },

        // ===================================================================
        // NEW — brand voice (denormalised per blog; see ARCHITECTURE.md)
        // ===================================================================
        brand_voice_source_type: {
          type: Sequelize.STRING(20),
          allowNull: true,
          comment: 'text | web_scrape | file_upload | none',
        },
        brand_voice_source_ref: {
          type: Sequelize.STRING(1000),
          allowNull: true,
          comment: 'URL scraped or filename uploaded, for provenance.',
        },
        brand_voice_tone: { type: Sequelize.STRING(255), allowNull: true },
        brand_voice_pov: { type: Sequelize.STRING(50), allowNull: true },
        brand_voice_traits: {
          type: Sequelize.JSON,
          allowNull: true,
          comment: 'Array of style rules, e.g. ["Always opens with a light joke"].',
        },
        brand_voice_confirmed: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
          comment: 'Hard gate: a human must confirm the AI-derived voice before generation runs.',
        },

        // ===================================================================
        // NEW — images
        // ===================================================================
        include_images: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        image_count: {
          type: Sequelize.TINYINT,
          allowNull: false,
          defaultValue: 1,
          comment: '1–4',
        },
        image_style: {
          type: Sequelize.STRING(30),
          allowNull: true,
          comment: 'photo | illustration | minimal | brand_colored',
        },
        logo_overlay: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        logo_position: {
          type: Sequelize.STRING(20),
          allowNull: true,
          comment: 'top_left | top_right | bottom_left | bottom_right | center | none',
        },
        extra_images: {
          type: Sequelize.JSON,
          allowNull: true,
          comment: 'Images beyond blog_picture: [{url, alt_text, has_logo_overlay, logo_position}]',
        },

        // ===================================================================
        // NEW — generation configuration
        // ===================================================================
        seo_structure_config: {
          type: Sequelize.JSON,
          allowNull: true,
          comment: '{h1,h2,h3,faq,tables,key_takeaways,quotes,lists,emphasis}',
        },
        internal_linking: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        internal_link_targets: {
          type: Sequelize.JSON,
          allowNull: true,
          comment: 'Blog ids/slugs eligible for or used as internal links.',
        },
        external_web_grounding: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
          comment: 'SerpAPI "connect to web" fact-grounding toggle.',
        },
        outline: {
          type: Sequelize.JSON,
          allowNull: true,
          comment: '[{level, text}] — AI-generated or hand-built.',
        },

        // ===================================================================
        // NEW — measurement
        // ===================================================================
        seo_score: {
          type: Sequelize.TINYINT,
          allowNull: true,
          comment: '0–100, from services/seoScore.js',
        },
        word_count: { type: Sequelize.INTEGER, allowNull: true },
        serp_rank_keyword: { type: Sequelize.STRING(255), allowNull: true },
        serp_rank_position: { type: Sequelize.INTEGER, allowNull: true },
        serp_rank_checked_at: { type: Sequelize.DATE, allowNull: true },

        // ===================================================================
        // NEW — generation state machine
        // ===================================================================
        generation_status: {
          type: Sequelize.STRING(20),
          allowNull: true,
          defaultValue: 'draft',
          comment: 'draft | queued | generating | generated | failed',
        },
        generation_config: {
          type: Sequelize.JSON,
          allowNull: true,
          comment: 'Full wizard submission snapshot, for audit and re-generation.',
        },
        generation_error: { type: Sequelize.TEXT, allowNull: true },

        // ===================================================================
        // NEW — taxonomy
        // ===================================================================
        category: { type: Sequelize.STRING(100), allowNull: true },
        tags: { type: Sequelize.JSON, allowNull: true },

        // ===================================================================
        // Timestamps / soft delete (existing)
        // ===================================================================
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        deleted_at: {
          type: Sequelize.DATE,
          allowNull: true,
          comment: 'Soft delete. Non-null means hidden from all default queries.',
        },
      },
      {
        // MySQL applies these; SQLite ignores them. utf8mb4 is required — the
        // live content contains Devanagari and emoji.
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
        engine: 'InnoDB',
      }
    );

    // Section 10 requires indexes on slug, blog_status and publish_date.
    await queryInterface.addIndex('blogs', {
      name: 'blogs_slug_unique',
      fields: ['slug'],
      unique: true,
    });
    await queryInterface.addIndex('blogs', {
      name: 'blogs_blog_status_idx',
      fields: ['blog_status'],
    });
    await queryInterface.addIndex('blogs', {
      name: 'blogs_publish_date_idx',
      fields: ['publish_date'],
    });
    // Backs the list view's default "published, newest first" ordering without
    // a filesort.
    await queryInterface.addIndex('blogs', {
      name: 'blogs_status_publish_date_idx',
      fields: ['blog_status', 'publish_date'],
    });
    // The dashboard polls for in-flight generations.
    await queryInterface.addIndex('blogs', {
      name: 'blogs_generation_status_idx',
      fields: ['generation_status'],
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('blogs');
  },
};
