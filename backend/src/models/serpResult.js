'use strict';

const { DataTypes } = require('sequelize');

/**
 * SerpResult — one organic result row belonging to a SerpSnapshot. The full
 * list is kept (not just whichever row matches our domain) so competitor
 * comparison has real data to work from.
 */
module.exports = (sequelize) => {
  const SerpResult = sequelize.define(
    'SerpResult',
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
      position: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      title: {
        type: DataTypes.STRING(512),
        allowNull: true,
      },
      url: {
        type: DataTypes.STRING(2048),
        allowNull: true,
      },
      domain: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      snippet: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      result_type: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'organic',
      },
      serp_feature: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
      },
    },
    {
      tableName: 'serp_results',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
      underscored: true,
      freezeTableName: true,
      indexes: [
        { name: 'serp_results_snapshot_position_idx', fields: ['snapshot_id', 'position'] },
        { name: 'serp_results_domain_idx', fields: ['domain'] },
      ],
    }
  );

  return SerpResult;
};
