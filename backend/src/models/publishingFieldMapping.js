'use strict';

const { DataTypes } = require('sequelize');

/**
 * PublishingFieldMapping — one row per field the client's API expects. See
 * the migration for the full rationale (dot-path client_field, fixed
 * scriptura_field allowlist, source_type field/static).
 */
module.exports = (sequelize) => {
  const PublishingFieldMapping = sequelize.define(
    'PublishingFieldMapping',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      integration_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },
      client_field: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      source_type: {
        type: DataTypes.ENUM('field', 'static'),
        allowNull: false,
        defaultValue: 'field',
      },
      scriptura_field: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      static_value: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      is_required: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      sort_order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: 'publishing_field_mappings',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      underscored: true,
      freezeTableName: true,
      indexes: [
        { name: 'pfm_integration_id_idx', fields: ['integration_id'] },
        { name: 'pfm_integration_sort_idx', fields: ['integration_id', 'sort_order'] },
      ],
    }
  );

  return PublishingFieldMapping;
};
