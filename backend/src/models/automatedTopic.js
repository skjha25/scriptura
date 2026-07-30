'use strict';

/**
 * Model for automated topics, used by the automated blog generator.
 * Stored in `automated_topics` table.
 */

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const AutomatedTopic = sequelize.define(
    'AutomatedTopic',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      topic: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
    },
    {
      tableName: 'automated_topics',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return AutomatedTopic;
};
