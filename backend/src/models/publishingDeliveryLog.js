'use strict';

const { DataTypes } = require('sequelize');

/**
 * PublishingDeliveryLog — one row per attempt to deliver a published blog
 * to a client's external POST endpoint. See the migration for the full
 * rationale (structural precedent: recommendation_actions).
 */
module.exports = (sequelize) => {
  const PublishingDeliveryLog = sequelize.define(
    'PublishingDeliveryLog',
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
      blog_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('pending', 'delivered', 'failed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      delivery_mode: {
        type: DataTypes.ENUM('create', 'update'),
        allowNull: false,
        defaultValue: 'create',
      },
      http_status: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      attempt_number: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      idempotency_key: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      request_field_names: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      response_summary: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      external_post_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      external_url: {
        type: DataTypes.STRING(2048),
        allowNull: true,
      },
      error: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      trace_id: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      completed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'publishing_delivery_logs',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
      underscored: true,
      freezeTableName: true,
      indexes: [
        { name: 'pdl_integration_id_idx', fields: ['integration_id'] },
        { name: 'pdl_blog_id_idx', fields: ['blog_id'] },
        { name: 'pdl_status_idx', fields: ['status'] },
        { name: 'pdl_idempotency_key_idx', fields: ['idempotency_key'] },
      ],
    }
  );

  return PublishingDeliveryLog;
};
