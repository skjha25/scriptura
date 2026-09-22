'use strict';

/**
 * Source-ingestion honesty fix (see the source-ingestion audit): adds an
 * explicit, persisted SOURCE ACCESS STATE (`content_status`) and PROVENANCE
 * (`content_method`) to `knowledge_sources` — separate from knowledge
 * confidence (`agent_knowledge.confidence`/`status`), which this table has
 * nothing to do with.
 *
 * Every existing row is backfilled to 'unknown' — a safe legacy value, never
 * written by new code. We do NOT retroactively guess 'full' for old rows:
 * some pre-fix YouTube rows may contain the old synthetic fallback sentence
 * ("Captions unavailable — title/author only.") which was exactly the false-
 * content bug this phase closes, so labeling old rows 'full' would fabricate
 * provenance we don't actually have. Existing `agent_knowledge` rows that
 * point at these sources are left untouched and remain usable.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('knowledge_sources', 'content_status', {
      type: Sequelize.ENUM('full', 'partial', 'metadata_only', 'unavailable', 'user_provided', 'unknown'),
      allowNull: true,
    });
    await queryInterface.addColumn('knowledge_sources', 'content_method', {
      type: Sequelize.ENUM('captions', 'oembed', 'html', 'manual_text', 'whisper', 'image_upload', 'unknown'),
      allowNull: true,
    });

    await queryInterface.sequelize.query(
      `UPDATE knowledge_sources SET content_status = 'unknown' WHERE content_status IS NULL`
    );
    await queryInterface.sequelize.query(
      `UPDATE knowledge_sources SET content_method = 'unknown' WHERE content_method IS NULL`
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE knowledge_sources MODIFY COLUMN content_status ENUM(
        'full', 'partial', 'metadata_only', 'unavailable', 'user_provided', 'unknown'
      ) NOT NULL DEFAULT 'unknown'`
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE knowledge_sources MODIFY COLUMN content_method ENUM(
        'captions', 'oembed', 'html', 'manual_text', 'whisper', 'image_upload', 'unknown'
      ) NOT NULL DEFAULT 'unknown'`
    );

    await queryInterface.addIndex('knowledge_sources', ['content_status'], { name: 'ks_content_status_idx' });
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('knowledge_sources', 'ks_content_status_idx');
    await queryInterface.removeColumn('knowledge_sources', 'content_method');
    await queryInterface.removeColumn('knowledge_sources', 'content_status');
  },
};
