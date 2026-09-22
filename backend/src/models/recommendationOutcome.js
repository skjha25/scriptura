'use strict';

const { DataTypes } = require('sequelize');

/**
 * RecommendationOutcome — P2-A: the deferred, deterministic measurement of
 * whether an already-executed RecommendationAction actually moved the metric
 * its parent AgentRecommendation was about. See the migration for the full
 * rationale (why this is a separate table from recommendation_actions, why
 * action_id rather than recommendation_id is unique, why outcome/
 * metric_deltas are deterministic-only with outcome_reasoning kept as a
 * separate optional LLM-authored column).
 */
module.exports = (sequelize) => {
  const RecommendationOutcome = sequelize.define(
    'RecommendationOutcome',
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
      action_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
        unique: true,
      },
      baseline_captured_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      baseline_evidence_refs: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      // P2-B: [{metric, value}] — the small set of already-computed numbers
      // the evidence_refs above point at, so evaluation never needs to
      // re-derive "what was baseline" from a joined snapshot. Never raw
      // SERP/GSC row data — see the migration for the full rationale.
      baseline_metric_snapshot: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      observation_window_days: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      due_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('pending', 'evaluated', 'inconclusive'),
        allowNull: false,
        defaultValue: 'pending',
      },
      fresh_evidence_refs: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      metric_deltas: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      outcome: {
        type: DataTypes.ENUM('improved', 'declined', 'neutral', 'inconclusive'),
        allowNull: true,
      },
      outcome_reasoning: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      evaluation_attempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      evaluated_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'recommendation_outcomes',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      underscored: true,
      freezeTableName: true,
      indexes: [
        { name: 'ro_recommendation_id_idx', fields: ['recommendation_id'] },
        { name: 'ro_status_due_at_idx', fields: ['status', 'due_at'] },
      ],
    }
  );

  return RecommendationOutcome;
};
