'use strict';

/**
 * Creates `publishing_field_mappings` — the per-integration payload builder:
 * one row per field the client's API expects. `client_field` supports
 * dot-paths (e.g. "post.title") so a configured mapping can assemble a
 * nested JSON payload without a separate "nested payload" data model.
 *
 * Owned child of `publishing_integrations` — RESTRICT, not CASCADE, matching
 * this codebase's recommendation_actions precedent: there is no "delete an
 * integration" affordance in v1 (only enable/disable), so a delete attempt
 * should fail loudly rather than silently discard field mappings.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('publishing_field_mappings', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      integration_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'publishing_integrations', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      client_field: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      source_type: {
        type: Sequelize.ENUM('field', 'static'),
        allowNull: false,
        defaultValue: 'field',
      },
      // Populated only when source_type='field' — one of a fixed allowlist
      // derived from the real Blog model (see payloadMapper.js), never an
      // arbitrary client-typed path on the Scriptura side.
      scriptura_field: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      // Populated only when source_type='static'.
      static_value: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      is_required: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      sort_order: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
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

    await queryInterface.addIndex('publishing_field_mappings', ['integration_id'], {
      name: 'pfm_integration_id_idx',
    });
    await queryInterface.addIndex('publishing_field_mappings', ['integration_id', 'sort_order'], {
      name: 'pfm_integration_sort_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('publishing_field_mappings');
  },
};
