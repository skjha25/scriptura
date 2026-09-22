'use strict';

const { DataTypes } = require('sequelize');
const { AGENT_NAMES } = require('../constants');

/**
 * LearningCandidate — P4-A: a deterministic, code-computed aggregation over
 * already-evaluated recommendation_outcomes (P2-B/P2-C), awaiting explicit
 * human confirm/reject. See the migration for the full rationale — why
 * scope/agent_name always start as 'agent'/non-null, why pattern_key has no
 * unique DB constraint, why evidence_refs needs no separate join table.
 */
module.exports = (sequelize) => {
  const LearningCandidate = sequelize.define(
    'LearningCandidate',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      pattern_key: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      scope: {
        type: DataTypes.ENUM('global', 'agent'),
        allowNull: false,
        defaultValue: 'agent',
      },
      agent_name: {
        type: DataTypes.ENUM(...Object.values(AGENT_NAMES)),
        allowNull: true,
      },
      category: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      topic: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      claim: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      evidence: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      reasoning: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      sample_size: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      improved_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      declined_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      neutral_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      inconclusive_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      confidence: {
        type: DataTypes.FLOAT,
        allowNull: false,
        defaultValue: 0.5,
      },
      evidence_refs: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('pending_review', 'confirmed', 'rejected'),
        allowNull: false,
        defaultValue: 'pending_review',
      },
      reviewed_by: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      reviewed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      confirmed_knowledge_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
    },
    {
      tableName: 'learning_candidates',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      underscored: true,
      freezeTableName: true,
      indexes: [
        { name: 'lc_pattern_key_idx', fields: ['pattern_key'] },
        { name: 'lc_status_idx', fields: ['status'] },
        { name: 'lc_agent_name_idx', fields: ['agent_name'] },
        { name: 'lc_pattern_key_status_idx', fields: ['pattern_key', 'status'] },
      ],
    }
  );

  return LearningCandidate;
};
