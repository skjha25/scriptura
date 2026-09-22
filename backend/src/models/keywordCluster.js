'use strict';

const { DataTypes } = require('sequelize');
const { CLUSTER_STATUS, CLUSTER_TYPE, LANGUAGES, IMAGE_COUNT_MIN, IMAGE_COUNT_MAX } = require('../constants');

module.exports = (sequelize) => {
  const KeywordCluster = sequelize.define(
    'KeywordCluster',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
          notEmpty: { msg: 'name cannot be empty.' },
        },
      },
      head_keyword: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
          notEmpty: { msg: 'head_keyword cannot be empty.' },
        },
      },
      cluster_type: {
        type: DataTypes.ENUM(...Object.values(CLUSTER_TYPE)),
        allowNull: false,
        defaultValue: CLUSTER_TYPE.HUB,
      },
      status: {
        type: DataTypes.ENUM(...Object.values(CLUSTER_STATUS)),
        allowNull: false,
        defaultValue: CLUSTER_STATUS.PLANNING,
      },
      total_search_volume: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      is_seasonal: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      seasonal_peak_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      lead_time_weeks: {
        type: DataTypes.TINYINT.UNSIGNED,
        allowNull: false,
        defaultValue: 6,
        validate: {
          min: { args: [1], msg: 'lead_time_weeks must be at least 1.' },
          max: { args: [52], msg: 'lead_time_weeks must be at most 52.' },
        },
      },
      cadence_posts_per_week: {
        type: DataTypes.TINYINT.UNSIGNED,
        allowNull: false,
        defaultValue: 2,
        validate: {
          min: { args: [1], msg: 'cadence_posts_per_week must be at least 1.' },
          max: { args: [14], msg: 'cadence_posts_per_week must be at most 14.' },
        },
      },
      priority_score: {
        type: DataTypes.TINYINT.UNSIGNED,
        allowNull: false,
        defaultValue: 50,
        validate: {
          min: { args: [0], msg: 'priority_score must be between 0 and 100.' },
          max: { args: [100], msg: 'priority_score must be between 0 and 100.' },
        },
      },
      pillar_blog_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      language: {
        type: DataTypes.STRING(10),
        allowNull: true,
        defaultValue: null,
        validate: {
          isIn: { args: [LANGUAGES], msg: `language must be one of ${LANGUAGES.join(', ')}.` },
        },
      },
      image_count: {
        type: DataTypes.TINYINT.UNSIGNED,
        allowNull: true,
        defaultValue: null,
        validate: {
          min: { args: [IMAGE_COUNT_MIN], msg: `image_count must be at least ${IMAGE_COUNT_MIN}.` },
          max: { args: [IMAGE_COUNT_MAX], msg: `image_count must be at most ${IMAGE_COUNT_MAX}.` },
        },
      },
    },
    {
      tableName: 'keyword_clusters',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      underscored: true,
      freezeTableName: true,
      indexes: [
        { name: 'kc_head_keyword_idx', fields: ['head_keyword'] },
        { name: 'kc_status_idx', fields: ['status'] },
      ],
    }
  );

  // =========================================================================
  // Instance helpers
  // =========================================================================

  /** True when the cluster has unfinished keywords to generate. */
  KeywordCluster.prototype.hasWork = function hasWork() {
    return this.status === CLUSTER_STATUS.ACTIVE;
  };

  /** True when all keywords in the cluster are published. */
  KeywordCluster.prototype.isComplete = function isComplete() {
    return this.status === CLUSTER_STATUS.COMPLETE;
  };

  return KeywordCluster;
};
