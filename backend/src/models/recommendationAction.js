'use strict';

const { DataTypes } = require('sequelize');

/**
 * RecommendationAction — P1-B: the human-tracked execution record for an
 * already-approved AgentRecommendation. See the migration for the full
 * rationale (why this is a separate, mutable-entity table rather than an
 * extension of agent_recommendations or agent_activity).
 */
module.exports = (sequelize) => {
  const RecommendationAction = sequelize.define(
    'RecommendationAction',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      recommendation_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },
      action_type: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('pending', 'completed', 'failed', 'cancelled'),
        allowNull: false,
        defaultValue: 'pending',
      },
      executor_type: {
        type: DataTypes.ENUM('manual', 'automated'),
        allowNull: false,
        defaultValue: 'manual',
      },
      executed_by: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      attempt_number: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      parameters: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      result_summary: {
        type: DataTypes.JSON,
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
      tableName: 'recommendation_actions',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      underscored: true,
      freezeTableName: true,
      indexes: [
        { name: 'ra_recommendation_id_idx', fields: ['recommendation_id'] },
        { name: 'ra_status_idx', fields: ['status'] },
        { name: 'ra_action_type_idx', fields: ['action_type'] },
        { name: 'ra_trace_id_idx', fields: ['trace_id'] },
        { name: 'ra_recommendation_status_idx', fields: ['recommendation_id', 'status'] },
      ],
    }
  );

  return RecommendationAction;
};
