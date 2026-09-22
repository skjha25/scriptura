'use strict';

const { DataTypes } = require('sequelize');

/**
 * GscSnapshot — one immutable point-in-time Google Search Console Search
 * Analytics observation for (site_url, date range, dimension set). Mirrors
 * SerpSnapshot (models/serpSnapshot.js) exactly; see that file and the
 * migration for the full rationale.
 */
module.exports = (sequelize) => {
  const GscSnapshot = sequelize.define(
    'GscSnapshot',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      site_url: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      date_range_start: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      date_range_end: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      dimensions: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      fetched_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      provider: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'gsc',
      },
      source_function: {
        type: DataTypes.STRING(32),
        allowNull: false,
      },
    },
    {
      tableName: 'gsc_snapshots',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
      underscored: true,
      freezeTableName: true,
      indexes: [
        { name: 'gsc_snapshots_identity_idx', fields: ['site_url', 'date_range_start', 'date_range_end'] },
        { name: 'gsc_snapshots_created_at_idx', fields: ['created_at'] },
      ],
    }
  );

  return GscSnapshot;
};
