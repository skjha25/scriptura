'use strict';

const { DataTypes } = require('sequelize');

/**
 * SourceChunk — deterministic char-window chunks of a KnowledgeSource (see
 * services/agents/knowledge/knowledgeSourceChunking.js), used to bound each
 * extraction call's input size for long sources instead of hard-truncating
 * them, and to give a distilled claim (AgentKnowledge.chunk_ids) something
 * concrete to point back at as evidence.
 */
module.exports = (sequelize) => {
  const SourceChunk = sequelize.define(
    'SourceChunk',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      source_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },
      sequence: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      text: {
        type: DataTypes.TEXT('medium'),
        allowNull: false,
      },
      char_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      embedding: {
        type: DataTypes.JSON,
        allowNull: true,
      },
    },
    {
      tableName: 'source_chunks',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
      underscored: true,
      freezeTableName: true,
      indexes: [{ name: 'sc_source_sequence_idx', fields: ['source_id', 'sequence'] }],
    }
  );

  return SourceChunk;
};
