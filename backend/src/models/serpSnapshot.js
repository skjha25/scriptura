'use strict';

const { DataTypes } = require('sequelize');

/**
 * SerpSnapshot — one immutable point-in-time SERP observation for a
 * (keyword, location, language, device) combination. See the migration for
 * why this exists: it is the first place real SerpAPI responses survive past
 * the request that fetched them.
 */
module.exports = (sequelize) => {
  const SerpSnapshot = sequelize.define(
    'SerpSnapshot',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      keyword: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      normalized_keyword: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      location: {
        type: DataTypes.STRING(8),
        allowNull: false,
      },
      language: {
        type: DataTypes.STRING(8),
        allowNull: false,
      },
      device: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'desktop',
      },
      provider: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'serpapi',
      },
      searched_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      total_results: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      serp_features: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      normalized_payload: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      source_function: {
        type: DataTypes.STRING(32),
        allowNull: false,
      },
    },
    {
      tableName: 'serp_snapshots',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
      underscored: true,
      freezeTableName: true,
      indexes: [
        { name: 'serp_snapshots_identity_idx', fields: ['normalized_keyword', 'location', 'language', 'device'] },
        { name: 'serp_snapshots_searched_at_idx', fields: ['searched_at'] },
      ],
    }
  );

  return SerpSnapshot;
};
