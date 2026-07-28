-- ===========================================================================
-- Scriptura — production adoption script
-- Adds the AI / editor / SEO columns to Divinetalk's EXISTING live `blogs` table.
-- ===========================================================================
--
-- WHEN TO USE THIS
-- The Sequelize migration in src/migrations/ CREATES a standalone `blogs` table
-- and is for fresh development databases. It will fail against production, where
-- the table already exists with real rows.
--
-- This script is the production path: it adds ONLY the new columns and indexes,
-- and touches no existing column and no existing row's data.
--
-- ---------------------------------------------------------------------------
-- BEFORE YOU RUN IT
-- ---------------------------------------------------------------------------
--   1. BACK UP. Non-negotiable:
--        mysqldump --single-transaction --routines --triggers \
--          -h <host> -u <user> -p <database> blogs > blogs-backup-$(date +%F).sql
--
--   2. Run it on a restored copy of production first and confirm the app works
--      against it. This script has been exercised against the dev schema, never
--      against the live table.
--
--   3. Check the table size. Every statement below is an in-place ALTER
--      (ALGORITHM=INPLACE where MySQL allows it), so reads and writes continue,
--      but on a very large table it still takes time and I/O:
--        SELECT table_rows, ROUND(data_length/1024/1024) AS data_mb
--        FROM information_schema.tables
--        WHERE table_schema = DATABASE() AND table_name = 'blogs';
--
--   4. Prefer a low-traffic window. If the table is large enough to worry about,
--      use gh-ost or pt-online-schema-change instead of running this directly.
--
-- ---------------------------------------------------------------------------
-- IDEMPOTENCY
-- ---------------------------------------------------------------------------
-- MySQL has no `ADD COLUMN IF NOT EXISTS`, so each statement is guarded by a
-- prepared-statement check against information_schema. Running this twice is
-- safe: the second run reports every column as already present and changes
-- nothing.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- See 002-rollback-ai-columns.sql. It drops only the columns added here, so the
-- table returns to its current shape. Existing data is untouched either way.
-- ===========================================================================

-- Fail loudly rather than silently truncating on a bad value.
SET SESSION sql_mode = 'STRICT_ALL_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

-- ---------------------------------------------------------------------------
-- Helper: add a column only if it is missing.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS scriptura_add_column;

DELIMITER //
CREATE PROCEDURE scriptura_add_column(
  IN p_table  VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_ddl    TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name   = p_table
      AND column_name  = p_column
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN ', p_ddl);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
    SELECT CONCAT('ADDED   ', p_table, '.', p_column) AS result;
  ELSE
    SELECT CONCAT('EXISTS  ', p_table, '.', p_column, ' — skipped') AS result;
  END IF;
END //

-- Helper: add an index only if it is missing.
CREATE PROCEDURE scriptura_add_index(
  IN p_table VARCHAR(64),
  IN p_index VARCHAR(64),
  IN p_ddl   TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name   = p_table
      AND index_name   = p_index
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD ', p_ddl);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
    SELECT CONCAT('ADDED   index ', p_table, '.', p_index) AS result;
  ELSE
    SELECT CONCAT('EXISTS  index ', p_table, '.', p_index, ' — skipped') AS result;
  END IF;
END //
DELIMITER ;

-- ===========================================================================
-- SEO / addressing
-- ===========================================================================
-- `slug` is nullable with no default. Existing rows get NULL, which the unique
-- index permits any number of (MySQL treats NULLs as distinct). Backfill is a
-- separate, reversible step — see the end of this file.
CALL scriptura_add_column('blogs', 'slug',
  '`slug` VARCHAR(255) NULL COMMENT ''URL slug generated from blog_title. Unique, indexed.''');
CALL scriptura_add_column('blogs', 'meta_title',       '`meta_title` VARCHAR(255) NULL');
CALL scriptura_add_column('blogs', 'meta_description', '`meta_description` VARCHAR(500) NULL');
CALL scriptura_add_column('blogs', 'og_image',         '`og_image` VARCHAR(1000) NULL');
CALL scriptura_add_column('blogs', 'canonical_url',    '`canonical_url` VARCHAR(1000) NULL');
CALL scriptura_add_column('blogs', 'secondary_keywords',
  '`secondary_keywords` JSON NULL COMMENT ''Array of extra target keywords.''');

-- ===========================================================================
-- Content
-- ===========================================================================
-- NOTE: `blog_content` (existing) becomes DERIVED from `content_blocks` once the
-- app is live. Existing rows keep their HTML and are left alone until someone
-- opens one in the editor; see the migration note in ARCHITECTURE.md about
-- back-filling content_blocks from legacy HTML.
CALL scriptura_add_column('blogs', 'content_blocks',
  '`content_blocks` JSON NULL COMMENT ''Ordered [{id,type,data}] block list. The editable source of truth.''');
CALL scriptura_add_column('blogs', 'article_type',
  '`article_type` VARCHAR(50) NULL COMMENT ''how_to | listicle | product_review | comparison | case_study | general''');
CALL scriptura_add_column('blogs', 'tone_of_voice',  '`tone_of_voice` VARCHAR(100) NULL');
CALL scriptura_add_column('blogs', 'point_of_view',  '`point_of_view` VARCHAR(50) NULL');
CALL scriptura_add_column('blogs', 'target_country', '`target_country` VARCHAR(100) NULL');
CALL scriptura_add_column('blogs', 'language',       '`language` VARCHAR(10) NULL DEFAULT ''en''');
CALL scriptura_add_column('blogs', 'readability_level',
  '`readability_level` VARCHAR(20) NULL COMMENT ''5th_grade | 8th_grade | college | none''');
CALL scriptura_add_column('blogs', 'ai_content_cleaning',
  '`ai_content_cleaning` TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''The "humanize" post-pass toggle.''');

-- ===========================================================================
-- Brand voice (denormalised per blog — see ARCHITECTURE.md)
-- ===========================================================================
CALL scriptura_add_column('blogs', 'brand_voice_source_type',
  '`brand_voice_source_type` VARCHAR(20) NULL COMMENT ''text | web_scrape | file_upload | none''');
CALL scriptura_add_column('blogs', 'brand_voice_source_ref', '`brand_voice_source_ref` VARCHAR(1000) NULL');
CALL scriptura_add_column('blogs', 'brand_voice_tone',       '`brand_voice_tone` VARCHAR(255) NULL');
CALL scriptura_add_column('blogs', 'brand_voice_pov',        '`brand_voice_pov` VARCHAR(50) NULL');
CALL scriptura_add_column('blogs', 'brand_voice_traits',     '`brand_voice_traits` JSON NULL');
CALL scriptura_add_column('blogs', 'brand_voice_confirmed',
  '`brand_voice_confirmed` TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''Hard gate: a human must confirm the AI-derived voice before generation runs.''');

-- ===========================================================================
-- Images
-- ===========================================================================
CALL scriptura_add_column('blogs', 'include_images', '`include_images` TINYINT(1) NOT NULL DEFAULT 1');
CALL scriptura_add_column('blogs', 'image_count',    '`image_count` TINYINT NOT NULL DEFAULT 1 COMMENT ''1–4''');
CALL scriptura_add_column('blogs', 'image_style',
  '`image_style` VARCHAR(30) NULL COMMENT ''photo | illustration | minimal | brand_colored''');
CALL scriptura_add_column('blogs', 'logo_overlay',   '`logo_overlay` TINYINT(1) NOT NULL DEFAULT 0');
CALL scriptura_add_column('blogs', 'logo_position',
  '`logo_position` VARCHAR(20) NULL COMMENT ''top_left | top_right | bottom_left | bottom_right | center | none''');
CALL scriptura_add_column('blogs', 'extra_images',
  '`extra_images` JSON NULL COMMENT ''[{url, alt_text, has_logo_overlay, logo_position}]''');

-- ===========================================================================
-- Generation configuration
-- ===========================================================================
CALL scriptura_add_column('blogs', 'seo_structure_config',
  '`seo_structure_config` JSON NULL COMMENT ''{h1,h2,h3,faq,tables,key_takeaways,quotes,lists,emphasis}''');
CALL scriptura_add_column('blogs', 'internal_linking',       '`internal_linking` TINYINT(1) NOT NULL DEFAULT 0');
CALL scriptura_add_column('blogs', 'internal_link_targets',  '`internal_link_targets` JSON NULL');
CALL scriptura_add_column('blogs', 'external_web_grounding',
  '`external_web_grounding` TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''SerpAPI fact-grounding toggle.''');
CALL scriptura_add_column('blogs', 'outline',
  '`outline` JSON NULL COMMENT ''[{level, text}]''');

-- ===========================================================================
-- Measurement
-- ===========================================================================
CALL scriptura_add_column('blogs', 'seo_score',
  '`seo_score` TINYINT NULL COMMENT ''0–100, from services/seoScore.js''');
CALL scriptura_add_column('blogs', 'word_count',           '`word_count` INT NULL');
CALL scriptura_add_column('blogs', 'serp_rank_keyword',    '`serp_rank_keyword` VARCHAR(255) NULL');
CALL scriptura_add_column('blogs', 'serp_rank_position',   '`serp_rank_position` INT NULL');
CALL scriptura_add_column('blogs', 'serp_rank_checked_at', '`serp_rank_checked_at` DATETIME NULL');

-- ===========================================================================
-- Generation state machine
-- ===========================================================================
-- Defaults to 'draft' so existing rows read as "not generated by Scriptura", which is
-- true — they predate it.
CALL scriptura_add_column('blogs', 'generation_status',
  '`generation_status` VARCHAR(20) NULL DEFAULT ''draft'' COMMENT ''draft | queued | generating | generated | failed''');
CALL scriptura_add_column('blogs', 'generation_config', '`generation_config` JSON NULL');
CALL scriptura_add_column('blogs', 'generation_error',  '`generation_error` TEXT NULL');

-- ===========================================================================
-- Taxonomy
-- ===========================================================================
CALL scriptura_add_column('blogs', 'category', '`category` VARCHAR(100) NULL');
CALL scriptura_add_column('blogs', 'tags',     '`tags` JSON NULL');

-- ===========================================================================
-- Indexes (Section 10 of the spec)
-- ===========================================================================
-- Add these AFTER the columns exist. On a large table each is a separate pass, so
-- expect this section to dominate the runtime.
CALL scriptura_add_index('blogs', 'blogs_slug_unique',
  'UNIQUE INDEX `blogs_slug_unique` (`slug`)');
CALL scriptura_add_index('blogs', 'blogs_blog_status_idx',
  'INDEX `blogs_blog_status_idx` (`blog_status`)');
CALL scriptura_add_index('blogs', 'blogs_publish_date_idx',
  'INDEX `blogs_publish_date_idx` (`publish_date`)');
CALL scriptura_add_index('blogs', 'blogs_status_publish_date_idx',
  'INDEX `blogs_status_publish_date_idx` (`blog_status`, `publish_date`)');
CALL scriptura_add_index('blogs', 'blogs_generation_status_idx',
  'INDEX `blogs_generation_status_idx` (`generation_status`)');

-- ---------------------------------------------------------------------------
-- Clean up the helpers.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS scriptura_add_column;
DROP PROCEDURE IF EXISTS scriptura_add_index;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
SELECT
  COUNT(*) AS new_columns_present,
  41       AS expected
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'blogs'
  AND column_name IN (
    'slug','meta_title','meta_description','og_image','canonical_url',
    'secondary_keywords','content_blocks','article_type','tone_of_voice',
    'point_of_view','target_country','language','readability_level',
    'ai_content_cleaning','brand_voice_source_type','brand_voice_source_ref',
    'brand_voice_tone','brand_voice_pov','brand_voice_traits',
    'brand_voice_confirmed','include_images','image_count','image_style',
    'logo_overlay','logo_position','extra_images','seo_structure_config',
    'internal_linking','internal_link_targets','external_web_grounding',
    'outline','seo_score','word_count','serp_rank_keyword','serp_rank_position',
    'serp_rank_checked_at','generation_status','generation_config',
    'generation_error','category','tags'
  );

-- ===========================================================================
-- OPTIONAL: back-fill slugs for existing rows
-- ===========================================================================
-- Run this ONLY after the app is verified working. It is separate because it is
-- the one part of adoption that writes to existing rows.
--
-- MySQL cannot produce a good slug on its own (no transliteration, no
-- de-duplication), so use the Node helper instead, which reuses the exact same
-- slug logic the application does:
--
--   cd backend && node scripts/prod-adoption/backfill-slugs.js --dry-run
--   cd backend && node scripts/prod-adoption/backfill-slugs.js --commit
--
-- Until slugs are backfilled, existing rows have slug = NULL. That is harmless:
-- the unique index allows many NULLs, and the app addresses rows by id as well as
-- by slug.
