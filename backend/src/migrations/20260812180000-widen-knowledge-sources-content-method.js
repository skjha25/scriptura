'use strict';

/**
 * Adds `youtube_captions` to `knowledge_sources.content_method` — the new,
 * working transcript-panel-based YouTube retrieval method (see
 * services/agents/knowledge/youtubeTranscriptProvider.js) that replaces the
 * old direct-`timedtext`-fetch approach tagged `captions`. `captions` is kept
 * in the ENUM for backward compat with any historical row (same
 * never-narrow-a-live-ENUM approach as
 * 20260811160200-alter-agent-knowledge-v2.js) — new code never writes it.
 */
module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(
      `ALTER TABLE knowledge_sources MODIFY COLUMN content_method ENUM(
        'captions', 'youtube_captions', 'oembed', 'html', 'manual_text', 'whisper', 'image_upload', 'unknown'
      ) NOT NULL DEFAULT 'unknown'`
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(
      `ALTER TABLE knowledge_sources MODIFY COLUMN content_method ENUM(
        'captions', 'oembed', 'html', 'manual_text', 'whisper', 'image_upload', 'unknown'
      ) NOT NULL DEFAULT 'unknown'`
    );
  },
};
