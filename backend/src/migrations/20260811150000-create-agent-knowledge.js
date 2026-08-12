'use strict';

/**
 * Creates `agent_knowledge` — the structured, versioned, confidence-scored
 * knowledge store shared by every admin chat agent (see
 * services/agents/knowledge/knowledgeStore.js). Deliberately a real
 * relational table, not another ScripturaSettings JSON blob: individual
 * claims need to be ranked, filtered, superseded, and cross-referenced
 * (supports/contradicts) independently of one another, which a single blob
 * per agent cannot support.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('agent_knowledge', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      scope: {
        type: Sequelize.ENUM('global', 'agent'),
        allowNull: false,
      },
      // NULL iff scope='global'.
      agent_name: {
        type: Sequelize.ENUM(
          'blog_image_agent',
          'generate_agent',
          'chief_agent',
          'seo_analyst_agent',
          'blog_ops_agent',
          'cluster_agent',
          'research_agent',
          'autopilot_agent'
        ),
        allowNull: true,
      },
      category: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      topic: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      claim: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      evidence: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      source_type: {
        type: Sequelize.ENUM('youtube', 'web_link', 'image', 'video', 'manual_text', 'outcome_feedback'),
        allowNull: false,
      },
      source_url: {
        type: Sequelize.STRING(2000),
        allowNull: true,
      },
      // e.g. an internal blog id, for outcome-derived knowledge — free-text,
      // not a real FK, since what it references varies by source_type.
      source_ref: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      confidence: {
        type: Sequelize.FLOAT,
        allowNull: false,
        defaultValue: 0.5,
      },
      status: {
        type: Sequelize.ENUM('unverified', 'supported', 'confirmed', 'contradicted', 'outdated'),
        allowNull: false,
        defaultValue: 'unverified',
      },
      applicable_context: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      // Array of other agent_knowledge ids this item supports/contradicts.
      // Deliberately a JSON array on the row rather than a join table — the
      // expected scale (hundreds-to-low-thousands of items) doesn't warrant
      // a graph structure.
      related_knowledge_ids: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      version: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      supersedes_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
        references: { model: 'agent_knowledge', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      usage_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      success_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      failure_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
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
      last_verified_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    // The exact shape every retrieval query filters on first (see §8 of the
    // architecture plan): scope + agent + status, then narrowed by category/topic.
    await queryInterface.addIndex('agent_knowledge', ['scope', 'agent_name', 'status'], {
      name: 'ak_scope_agent_status_idx',
    });
    await queryInterface.addIndex('agent_knowledge', ['category', 'topic'], {
      name: 'ak_category_topic_idx',
    });
    await queryInterface.addIndex('agent_knowledge', ['created_at'], {
      name: 'ak_created_at_idx',
    });

    // FULLTEXT for the retrieval query's relevance ranking (see knowledgeStore.js).
    await queryInterface.sequelize.query(
      'ALTER TABLE agent_knowledge ADD FULLTEXT INDEX ak_fulltext_idx (topic, category, claim)'
    );
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('agent_knowledge');
  },
};
