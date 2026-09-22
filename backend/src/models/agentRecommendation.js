'use strict';

const { DataTypes } = require('sequelize');
const { AGENT_NAMES } = require('../constants');

/**
 * AgentRecommendation — P0 of the Decision/Outcome/Evaluation architecture.
 * One row per distinct "an agent suggested X" event, captured from a tool's
 * `{type:'proposed_change'}` result. See the migration for the full
 * rationale and the explicit P0 scope boundary (status stays 'recommended'
 * in this phase; 'approved'/'rejected' are reserved, not yet wired).
 */
module.exports = (sequelize) => {
  const AgentRecommendation = sequelize.define(
    'AgentRecommendation',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      trace_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      agent_name: {
        type: DataTypes.ENUM(...Object.values(AGENT_NAMES)),
        allowNull: false,
      },
      source_activity_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
        unique: true,
      },
      recommendation_type: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      summary: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      recommendation_details: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      target_ref: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      expected_metric: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      expected_direction: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      expected_change: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      observation_window_days: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      confidence: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('recommended', 'approved', 'rejected'),
        allowNull: false,
        defaultValue: 'recommended',
      },
      // P1-A: who decided, and when. Both null until a human actually
      // approves/rejects — see services/agents/recommendationDecisions.js,
      // the sole writer of these two fields.
      decided_by: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      decided_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'agent_recommendations',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      underscored: true,
      freezeTableName: true,
      indexes: [
        { name: 'ar_trace_id_idx', fields: ['trace_id'] },
        { name: 'ar_agent_name_idx', fields: ['agent_name'] },
        { name: 'ar_status_idx', fields: ['status'] },
        { name: 'ar_recommendation_type_idx', fields: ['recommendation_type'] },
      ],
    }
  );

  return AgentRecommendation;
};
