-- ===========================================================================
-- Scriptura — rollback for 001-add-ai-columns.sql
-- ===========================================================================
--
-- Drops ONLY the columns and indexes that 001 added, returning `blogs` to its
-- pre-Scriptura shape. The pre-existing columns and every row's original data are
-- untouched.
--
-- ⚠️  THIS IS DESTRUCTIVE FOR SCRIPTURA DATA. Everything authored through Scriptura lives
-- in these columns — `content_blocks`, brand voice, generation config, SEO
-- scores. Dropping them discards that permanently.
--
-- `blog_content`, `blog_title`, `blog_picture` and the other original columns
-- survive, so articles already published remain published and readable. What is
-- lost is the ability to re-edit them block-by-block.
--
-- BEFORE RUNNING: take a backup, exactly as for 001.
--   mysqldump --single-transaction -h <host> -u <user> -p <database> blogs \
--     > blogs-pre-rollback-$(date +%F).sql
--
-- Like 001, this is idempotent — a second run reports everything as already gone.
-- ===========================================================================

SET SESSION sql_mode = 'STRICT_ALL_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

DROP PROCEDURE IF EXISTS scriptura_drop_column;
DROP PROCEDURE IF EXISTS scriptura_drop_index;

DELIMITER //
CREATE PROCEDURE scriptura_drop_column(IN p_table VARCHAR(64), IN p_column VARCHAR(64))
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = p_table AND column_name = p_column
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` DROP COLUMN `', p_column, '`');
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
    SELECT CONCAT('DROPPED ', p_table, '.', p_column) AS result;
  ELSE
    SELECT CONCAT('ABSENT  ', p_table, '.', p_column, ' — skipped') AS result;
  END IF;
END //

CREATE PROCEDURE scriptura_drop_index(IN p_table VARCHAR(64), IN p_index VARCHAR(64))
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = p_table AND index_name = p_index
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` DROP INDEX `', p_index, '`');
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
    SELECT CONCAT('DROPPED index ', p_table, '.', p_index) AS result;
  ELSE
    SELECT CONCAT('ABSENT  index ', p_table, '.', p_index, ' — skipped') AS result;
  END IF;
END //
DELIMITER ;

-- Indexes first: an index on a column cannot outlive the column, and dropping it
-- explicitly keeps the output legible.
CALL scriptura_drop_index('blogs', 'blogs_generation_status_idx');
CALL scriptura_drop_index('blogs', 'blogs_status_publish_date_idx');
CALL scriptura_drop_index('blogs', 'blogs_publish_date_idx');
CALL scriptura_drop_index('blogs', 'blogs_blog_status_idx');
CALL scriptura_drop_index('blogs', 'blogs_slug_unique');

-- Columns, in reverse order of 001 for readability.
CALL scriptura_drop_column('blogs', 'tags');
CALL scriptura_drop_column('blogs', 'category');
CALL scriptura_drop_column('blogs', 'generation_error');
CALL scriptura_drop_column('blogs', 'generation_config');
CALL scriptura_drop_column('blogs', 'generation_status');
CALL scriptura_drop_column('blogs', 'serp_rank_checked_at');
CALL scriptura_drop_column('blogs', 'serp_rank_position');
CALL scriptura_drop_column('blogs', 'serp_rank_keyword');
CALL scriptura_drop_column('blogs', 'word_count');
CALL scriptura_drop_column('blogs', 'seo_score');
CALL scriptura_drop_column('blogs', 'outline');
CALL scriptura_drop_column('blogs', 'external_web_grounding');
CALL scriptura_drop_column('blogs', 'internal_link_targets');
CALL scriptura_drop_column('blogs', 'internal_linking');
CALL scriptura_drop_column('blogs', 'seo_structure_config');
CALL scriptura_drop_column('blogs', 'extra_images');
CALL scriptura_drop_column('blogs', 'logo_position');
CALL scriptura_drop_column('blogs', 'logo_overlay');
CALL scriptura_drop_column('blogs', 'image_style');
CALL scriptura_drop_column('blogs', 'image_count');
CALL scriptura_drop_column('blogs', 'include_images');
CALL scriptura_drop_column('blogs', 'brand_voice_confirmed');
CALL scriptura_drop_column('blogs', 'brand_voice_traits');
CALL scriptura_drop_column('blogs', 'brand_voice_pov');
CALL scriptura_drop_column('blogs', 'brand_voice_tone');
CALL scriptura_drop_column('blogs', 'brand_voice_source_ref');
CALL scriptura_drop_column('blogs', 'brand_voice_source_type');
CALL scriptura_drop_column('blogs', 'ai_content_cleaning');
CALL scriptura_drop_column('blogs', 'readability_level');
CALL scriptura_drop_column('blogs', 'language');
CALL scriptura_drop_column('blogs', 'target_country');
CALL scriptura_drop_column('blogs', 'point_of_view');
CALL scriptura_drop_column('blogs', 'tone_of_voice');
CALL scriptura_drop_column('blogs', 'article_type');
CALL scriptura_drop_column('blogs', 'content_blocks');
CALL scriptura_drop_column('blogs', 'secondary_keywords');
CALL scriptura_drop_column('blogs', 'canonical_url');
CALL scriptura_drop_column('blogs', 'og_image');
CALL scriptura_drop_column('blogs', 'meta_description');
CALL scriptura_drop_column('blogs', 'meta_title');
CALL scriptura_drop_column('blogs', 'slug');

DROP PROCEDURE IF EXISTS scriptura_drop_column;
DROP PROCEDURE IF EXISTS scriptura_drop_index;

-- Verify: should report 0.
SELECT COUNT(*) AS scriptura_columns_remaining
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
