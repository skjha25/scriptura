'use strict';

const { DataTypes } = require('sequelize');
const { AGENT_NAMES } = require('../constants');

/**
 * AgentKnowledge — the structured, versioned, confidence-scored knowledge
 * store shared by every admin chat agent.
 *
 * Deliberately a real relational table, not another ScripturaSettings JSON
 * blob (compare `agents.generate.style_profile`, `agents.<name>.golden_rules`):
 * individual claims need to be ranked, filtered, superseded, and
 * cross-referenced (supports/contradicts) independently of one another,
 * which a single blob per agent cannot support once there's more than one
 * fact to track.
 *
 * `scope='global'` rows have `agent_name=null` and are visible to every
 * agent's retrieval query; `scope='agent'` rows are scoped to exactly one
 * agent. See services/agents/knowledge/knowledgeStore.js for the retrieval
 * query this schema is shaped around.
 *
 * The FULLTEXT index this table's retrieval relies on (`ak_fulltext_idx` on
 * topic/category/claim) is MySQL-only and created via raw SQL in the
 * migration, NOT declared here — SQLite (the test-suite dialect, see
 * config/database.js) has no FULLTEXT index type, so declaring it here would
 * break `syncSchema()`. `knowledgeStore.js`'s retrieval query branches on
 * `sequelize.getDialect()` accordingly.
 */
module.exports = (sequelize) => {
  const AgentKnowledge = sequelize.define(
    'AgentKnowledge',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      scope: {
        type: DataTypes.ENUM('global', 'agent'),
        allowNull: false,
      },
      agent_name: {
        type: DataTypes.ENUM(...Object.values(AGENT_NAMES)),
        allowNull: true,
      },
      category: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      topic: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      claim: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      evidence: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      source_type: {
        type: DataTypes.ENUM('youtube', 'web_link', 'image', 'video', 'manual_text', 'outcome_feedback'),
        allowNull: false,
      },
      source_url: {
        type: DataTypes.STRING(2000),
        allowNull: true,
      },
      source_ref: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      confidence: {
        type: DataTypes.FLOAT,
        allowNull: false,
        defaultValue: 0.5,
      },
      // 'contested' added in Knowledge Layer v2 — replaces the old
      // 'contradicted' hide-both-sides behavior with a surfaced,
      // both-sides-visible pair (see knowledgeBase.js's contradicts branch
      // and runAgentTurn.js's withKnowledge contested-pair formatter).
      // 'contradicted' is kept for backward compat with any pre-v2 row —
      // no rows actually used it (checked: 0 in production data), but the
      // value isn't removed to avoid narrowing a live ENUM.
      status: {
        type: DataTypes.ENUM('unverified', 'supported', 'confirmed', 'contradicted', 'contested', 'outdated'),
        allowNull: false,
        defaultValue: 'unverified',
      },
      // WHAT KIND of knowledge (fact/strategy/procedure/...) — orthogonal to
      // `category`, which is WHAT DOMAIN it belongs to (seo_strategy,
      // workflow, ...). Nullable only because pre-v2 rows are backfilled to
      // 'fact' by the migration, not because a real row should ever lack one.
      knowledge_type: {
        type: DataTypes.ENUM(
          'fact',
          'strategy',
          'procedure',
          'observation',
          'hypothesis',
          'opinion',
          'guideline',
          'terminology',
          'pattern',
          'source_reliability'
        ),
        allowNull: true,
      },
      // Links back to the raw source this claim was distilled from — see
      // models/knowledgeSource.js. Nullable: pre-v2 rows have no source row
      // (their raw content was never persisted), and a manually-authored
      // Golden-Rule-style claim may legitimately have no source at all.
      source_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      // Array of source_chunks ids that specifically support this claim —
      // finer-grained than source_id alone, for "why do you believe this."
      chunk_ids: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      // This claim's own embedding (from `claim`, sometimes `topic`+`claim`
      // combined — see knowledgeEmbedding.js), used for semantic retrieval.
      // Nullable: embedding generation is best-effort and must never block
      // a confirm — see knowledgeBase.js's embedAndStore.
      embedding: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      applicable_context: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      related_knowledge_ids: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      version: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      supersedes_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      usage_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      success_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      failure_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      created_by: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      last_verified_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'agent_knowledge',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      underscored: true,
      freezeTableName: true,
      indexes: [
        { name: 'ak_scope_agent_status_idx', fields: ['scope', 'agent_name', 'status'] },
        { name: 'ak_category_topic_idx', fields: ['category', 'topic'] },
        { name: 'ak_created_at_idx', fields: ['created_at'] },
      ],
    }
  );

  return AgentKnowledge;
};
