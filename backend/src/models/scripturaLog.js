'use strict';

const { DataTypes } = require('sequelize');
const { LOG_EVENT_TYPES, LOG_STATUS, LOG_TRIGGERED_BY } = require('../constants');

/**
 * ScripturaLog — append-only activity log for generation lifecycle monitoring.
 *
 * Every generation event, autopilot trigger, and scheduled publish is recorded
 * here. Logs are immutable (no updatedAt), never soft-deleted, and retained
 * indefinitely for audit and debugging.
 */
module.exports = (sequelize) => {
  const ScripturaLog = sequelize.define(
    'ScripturaLog',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      blog_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      cluster_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      keyword_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      event_type: {
        type: DataTypes.ENUM(...Object.values(LOG_EVENT_TYPES)),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(...Object.values(LOG_STATUS)),
        allowNull: false,
        defaultValue: LOG_STATUS.INFO,
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      error_message: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      error_stack: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      duration_ms: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: true,
      },
      word_count: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: true,
      },
      seo_score: {
        type: DataTypes.TINYINT.UNSIGNED,
        allowNull: true,
      },
      aeo_score: {
        type: DataTypes.TINYINT.UNSIGNED,
        allowNull: true,
      },
      geo_score: {
        type: DataTypes.TINYINT.UNSIGNED,
        allowNull: true,
      },
      block_count: {
        type: DataTypes.SMALLINT.UNSIGNED,
        allowNull: true,
      },
      triggered_by: {
        type: DataTypes.ENUM(...Object.values(LOG_TRIGGERED_BY)),
        allowNull: false,
        defaultValue: LOG_TRIGGERED_BY.SYSTEM,
      },
      user_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      provider: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
      },
    },
    {
      tableName: 'scriptura_logs',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false, // Logs are immutable — no updates.
      underscored: true,
      freezeTableName: true,
      indexes: [
        { name: 'logs_blog_id_idx', fields: ['blog_id'] },
        { name: 'logs_cluster_id_idx', fields: ['cluster_id'] },
        { name: 'logs_keyword_id_idx', fields: ['keyword_id'] },
        { name: 'logs_event_type_idx', fields: ['event_type'] },
        { name: 'logs_status_idx', fields: ['status'] },
        { name: 'logs_created_at_idx', fields: ['created_at'] },
        { name: 'logs_triggered_by_idx', fields: ['triggered_by'] },
      ],
    }
  );

  return ScripturaLog;
};
