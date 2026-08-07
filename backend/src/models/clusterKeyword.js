'use strict';

const { DataTypes } = require('sequelize');
const { CLUSTER_KEYWORD_STATUS, SEARCH_INTENT } = require('../constants');

module.exports = (sequelize) => {
  const ClusterKeyword = sequelize.define(
    'ClusterKeyword',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      cluster_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },
      keyword: {
        type: DataTypes.STRING(500),
        allowNull: false,
        validate: {
          notEmpty: { msg: 'keyword cannot be empty.' },
        },
      },
      search_intent: {
        type: DataTypes.ENUM(...Object.values(SEARCH_INTENT)),
        allowNull: false,
        defaultValue: SEARCH_INTENT.INFORMATIONAL,
      },
      suggested_publish_date: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      scheduled_generation_date: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      sequence_order: {
        type: DataTypes.TINYINT.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
      },
      assigned_blog_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM(...Object.values(CLUSTER_KEYWORD_STATUS)),
        allowNull: false,
        defaultValue: CLUSTER_KEYWORD_STATUS.PENDING,
      },
    },
    {
      tableName: 'cluster_keywords',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      underscored: true,
      freezeTableName: true,
      indexes: [
        { name: 'ckw_cluster_id_idx', fields: ['cluster_id'] },
        { name: 'ckw_assigned_blog_id_idx', fields: ['assigned_blog_id'] },
        { name: 'ckw_status_idx', fields: ['status'] },
        { name: 'ckw_gen_date_unique', unique: true, fields: ['scheduled_generation_date'] },
        { name: 'ckw_status_gen_date_idx', fields: ['status', 'scheduled_generation_date'] },
      ],
    }
  );

  return ClusterKeyword;
};
