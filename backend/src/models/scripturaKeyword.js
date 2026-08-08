'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ScripturaKeyword = sequelize.define(
    'ScripturaKeyword',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      primary_keyword: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      secondary_keywords: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      search_intent: {
        type: DataTypes.ENUM('informational', 'transactional', 'navigational'),
        defaultValue: 'informational',
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('not_used', 'in_progress', 'used'),
        defaultValue: 'not_used',
        allowNull: false,
      },
      serp_data: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      used_in_blog_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
    },
    {
      tableName: 'scriptura_keywords',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return ScripturaKeyword;
};
