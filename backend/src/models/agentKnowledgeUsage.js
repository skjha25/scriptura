'use strict';

const { DataTypes } = require('sequelize');
const { AGENT_NAMES } = require('../constants');

/**
 * AgentKnowledgeUsage — one row per (chat turn, retrieved knowledge item).
 * Written by services/agents/runAgentTurn.js's recordKnowledgeUsage
 * alongside the existing usage_count bump on AgentKnowledge, so "what
 * knowledge influenced this specific answer" is a stored, queryable fact —
 * closes the audit's Part 2 point-5/6 gap (previously provable only by a
 * one-off script, never from data already at rest).
 */
module.exports = (sequelize) => {
  const AgentKnowledgeUsage = sequelize.define(
    'AgentKnowledgeUsage',
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
      knowledge_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },
      relevance_score: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      retrieval_method: {
        type: DataTypes.ENUM('lexical', 'semantic', 'hybrid'),
        allowNull: false,
        defaultValue: 'hybrid',
      },
    },
    {
      tableName: 'agent_knowledge_usage',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
      underscored: true,
      freezeTableName: true,
      indexes: [
        { name: 'aku_trace_id_idx', fields: ['trace_id'] },
        { name: 'aku_knowledge_id_idx', fields: ['knowledge_id'] },
      ],
    }
  );

  return AgentKnowledgeUsage;
};
