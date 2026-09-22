'use strict';

const { DataTypes } = require('sequelize');

/**
 * GscRow — one Search Analytics row belonging to a GscSnapshot. Mirrors
 * SerpResult (models/serpResult.js); see that file and the migration for the
 * full rationale. Every dimension column is nullable because a snapshot only
 * populates whichever dimensions it was fetched with.
 */
module.exports = (sequelize) => {
  const GscRow = sequelize.define(
    'GscRow',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      snapshot_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },
      query: {
        type: DataTypes.STRING(512),
        allowNull: true,
      },
      page: {
        type: DataTypes.STRING(2048),
        allowNull: true,
      },
      country: {
        type: DataTypes.STRING(8),
        allowNull: true,
      },
      device: {
        type: DataTypes.STRING(16),
        allowNull: true,
      },
      search_appearance: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      clicks: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      impressions: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      ctr: {
        type: DataTypes.FLOAT,
        allowNull: false,
        defaultValue: 0,
      },
      position: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
    },
    {
      tableName: 'gsc_rows',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
      underscored: true,
      freezeTableName: true,
      indexes: [
        { name: 'gsc_rows_snapshot_idx', fields: ['snapshot_id'] },
        { name: 'gsc_rows_query_idx', fields: ['query'] },
        { name: 'gsc_rows_page_idx', fields: [{ attribute: 'page', length: 255 }] },
      ],
    }
  );

  return GscRow;
};
