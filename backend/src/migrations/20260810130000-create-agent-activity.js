'use strict';

/**
 * Creates the `agent_activity` table — append-only audit trail for the
 * agentic-AI chat layer (Blog Image Agent, Generate Agent, Chief Agent).
 *
 * One row per step of an agent's tool-use loop (user message, tool call,
 * proposed/applied/reverted setting, delegation, final reply), so a whole
 * chat turn — including a Chief Agent delegation chain — is reconstructable
 * from `trace_id` alone. Deliberately a separate table from `scriptura_logs`:
 * that table's columns (blog_id/cluster_id/keyword_id) are blog-centric and
 * don't fit orchestration concepts like trace_id/from_agent/to_agent/tool_name.
 *
 * Logs are append-only (no updatedAt) and never deleted by the application.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('agent_activity', {
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
        type: Sequelize.ENUM('blog_image_agent', 'generate_agent', 'chief_agent'),
        allowNull: false,
      },
      event_type: {
        type: Sequelize.ENUM(
          'user_message',
          'delegation',
          'tool_call',
          'setting_proposed',
          'setting_applied',
          'setting_reverted',
          'error',
          'final_reply'
        ),
        allowNull: false,
      },
      from_agent: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      to_agent: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      tool_name: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      // Denormalised so revert can find "the most recent setting_applied row
      // for this key" with an index, instead of a JSON-path query on `payload`.
      setting_key: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('success', 'failure', 'warning', 'info'),
        allowNull: false,
        defaultValue: 'info',
      },
      payload: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      user_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('agent_activity', ['trace_id'], { name: 'aa_trace_id_idx' });
    await queryInterface.addIndex('agent_activity', ['agent_name'], { name: 'aa_agent_name_idx' });
    await queryInterface.addIndex('agent_activity', ['event_type'], { name: 'aa_event_type_idx' });
    await queryInterface.addIndex('agent_activity', ['tool_name'], { name: 'aa_tool_name_idx' });
    await queryInterface.addIndex('agent_activity', ['setting_key'], { name: 'aa_setting_key_idx' });
    await queryInterface.addIndex('agent_activity', ['user_id'], { name: 'aa_user_id_idx' });
    await queryInterface.addIndex('agent_activity', ['created_at'], { name: 'aa_created_at_idx' });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('agent_activity');
  },
};
