'use strict';

/**
 * Creates `agent_knowledge_usage` — one row per (chat turn, retrieved
 * knowledge item), so "what knowledge influenced this answer" is a stored,
 * queryable fact instead of something only provable by re-running a
 * one-off script (the audit's Part 2, points 5-6 gap). Written by
 * services/agents/runAgentTurn.js's recordKnowledgeUsage alongside the
 * existing usage_count bump on agent_knowledge.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('agent_knowledge_usage', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      trace_id: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
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
        allowNull: false,
      },
      knowledge_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'agent_knowledge', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      relevance_score: {
        type: Sequelize.FLOAT,
        allowNull: true,
      },
      retrieval_method: {
        type: Sequelize.ENUM('lexical', 'semantic', 'hybrid'),
        allowNull: false,
        defaultValue: 'hybrid',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('agent_knowledge_usage', ['trace_id'], { name: 'aku_trace_id_idx' });
    await queryInterface.addIndex('agent_knowledge_usage', ['knowledge_id'], { name: 'aku_knowledge_id_idx' });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('agent_knowledge_usage');
  },
};
