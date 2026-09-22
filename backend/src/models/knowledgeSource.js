'use strict';

const { DataTypes } = require('sequelize');

/**
 * KnowledgeSource — the raw-source layer (Knowledge Layer v2). Persists what
 * was actually fed to a "teach this agent" submission — full text for
 * text/link/YouTube/video-transcript sources, a storage reference for
 * images — so an admin (or agent) can later ask "show me the original
 * source" instead of only ever seeing the distilled claim in AgentKnowledge.
 *
 * Text content lives directly in `content` (LONGTEXT) rather than in the
 * existing blob storage — a full transcript is a few hundred KB at most,
 * trivial for MySQL, and keeping it in the same row as its metadata avoids a
 * second round trip for something this small. Only `source_type='image'`
 * rows set `storage_path` instead, reusing the EXISTING storage driver
 * (services/storage/index.js, already used by /media/upload) rather than
 * duplicating the image bytes into this table.
 */
module.exports = (sequelize) => {
  const KnowledgeSource = sequelize.define(
    'KnowledgeSource',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      source_type: {
        type: DataTypes.ENUM('youtube', 'web_link', 'image', 'video', 'manual_text'),
        allowNull: false,
      },
      source_url: {
        type: DataTypes.STRING(2000),
        allowNull: true,
      },
      title: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      author: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      content: {
        type: DataTypes.TEXT('long'),
        allowNull: true,
      },
      storage_path: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      content_hash: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      // SOURCE ACCESS STATE — "how much of the actual source content did we
      // successfully access", never knowledge confidence (see
      // models/agentKnowledge.js's `confidence`/`status`, which is a separate
      // axis entirely). Gates knowledgeExtraction.js: 'metadata_only' and
      // 'unavailable' sources are never sent to Claude for substantive claim
      // extraction — see extractFromSources's per-source content_status check.
      // 'unknown' is the safe legacy value for rows created before this
      // column existed (see migration 20260812... default) — never written by
      // new code, only ever backfilled onto old rows.
      content_status: {
        type: DataTypes.ENUM('full', 'partial', 'metadata_only', 'unavailable', 'user_provided', 'unknown'),
        allowNull: false,
        defaultValue: 'unknown',
      },
      // PROVENANCE — how the content was actually obtained, independent of
      // content_status. 'unknown' is the same legacy-backfill value as above.
      content_method: {
        // 'captions' = old, now-broken direct-timedtext-fetch method, kept
        // only for backward compat with historical rows — never written by
        // new code. 'youtube_captions' = the real transcript-panel-scrape
        // method (see services/agents/knowledge/youtubeTranscriptProvider.js).
        type: DataTypes.ENUM('captions', 'youtube_captions', 'oembed', 'html', 'manual_text', 'whisper', 'image_upload', 'unknown'),
        allowNull: false,
        defaultValue: 'unknown',
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      created_by: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
    },
    {
      tableName: 'knowledge_sources',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      underscored: true,
      freezeTableName: true,
      indexes: [
        { name: 'ks_content_hash_idx', fields: ['content_hash'] },
        { name: 'ks_source_type_idx', fields: ['source_type'] },
        { name: 'ks_created_at_idx', fields: ['created_at'] },
      ],
    }
  );

  return KnowledgeSource;
};
