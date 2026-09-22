'use strict';

const { DataTypes } = require('sequelize');

/**
 * PublishingIntegration — a client's own external POST endpoint +
 * credentials. See the migration for the full rationale.
 */
module.exports = (sequelize) => {
  const PublishingIntegration = sequelize.define(
    'PublishingIntegration',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      endpoint_url: {
        type: DataTypes.STRING(2048),
        allowNull: false,
      },
      test_endpoint_url: {
        type: DataTypes.STRING(2048),
        allowNull: true,
      },
      auth_type: {
        type: DataTypes.ENUM('none', 'bearer', 'api_key', 'custom_header'),
        allowNull: false,
        defaultValue: 'none',
      },
      auth_header_name: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      auth_secret_encrypted: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      response_id_path: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      response_url_path: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      request_format: {
        type: DataTypes.ENUM('json', 'multipart'),
        allowNull: false,
        defaultValue: 'json',
      },
      max_file_kb: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: true,
      },
      update_endpoint_url: {
        type: DataTypes.STRING(2048),
        allowNull: true,
      },
      update_id_field: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      tableName: 'publishing_integrations',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      underscored: true,
      freezeTableName: true,
      indexes: [{ name: 'pub_int_enabled_idx', fields: ['enabled'] }],
    }
  );

  return PublishingIntegration;
};
