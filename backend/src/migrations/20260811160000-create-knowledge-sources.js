'use strict';

/**
 * Creates `knowledge_sources` — the raw-source layer the Knowledge Layer v2
 * audit found missing (sources were fetched, concatenated, truncated at 24k
 * chars, then discarded; nothing let an admin later ask "show me the
 * original source"). Text content (pasted text, scraped articles, YouTube
 * captions, video transcripts) lives directly in the `content` LONGTEXT
 * column — a 2-hour transcript is ~150-200KB, trivial for MySQL, no reason
 * to round-trip through file storage for text. Only images reference the
 * EXISTING blob storage (`services/storage/index.js`, already used by
 * /media/upload) via `storage_path`, so image bytes are never duplicated.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('knowledge_sources', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      source_type: {
        type: Sequelize.ENUM('youtube', 'web_link', 'image', 'video', 'manual_text'),
        allowNull: false,
      },
      source_url: {
        type: Sequelize.STRING(2000),
        allowNull: true,
      },
      title: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      author: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      // Full untruncated text for text/link/youtube/video-transcript sources.
      content: {
        type: Sequelize.TEXT('long'),
        allowNull: true,
      },
      // relativePath into the existing storage driver — set only for image sources.
      storage_path: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      content_hash: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      metadata: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      created_by: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
        references: { model: 'users_scriptura', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('knowledge_sources', ['content_hash'], { name: 'ks_content_hash_idx' });
    await queryInterface.addIndex('knowledge_sources', ['source_type'], { name: 'ks_source_type_idx' });
    await queryInterface.addIndex('knowledge_sources', ['created_at'], { name: 'ks_created_at_idx' });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('knowledge_sources');
  },
};
