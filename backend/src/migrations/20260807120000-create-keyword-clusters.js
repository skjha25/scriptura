'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // --- keyword_clusters ---------------------------------------------------
    await queryInterface.createTable('keyword_clusters', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      head_keyword: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      cluster_type: {
        type: Sequelize.ENUM('pillar', 'hub'),
        allowNull: false,
        defaultValue: 'hub',
      },
      status: {
        type: Sequelize.ENUM('planning', 'active', 'complete', 'paused'),
        allowNull: false,
        defaultValue: 'planning',
      },
      total_search_volume: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      is_seasonal: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      seasonal_peak_date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      lead_time_weeks: {
        type: Sequelize.TINYINT.UNSIGNED,
        allowNull: false,
        defaultValue: 6,
      },
      cadence_posts_per_week: {
        type: Sequelize.TINYINT.UNSIGNED,
        allowNull: false,
        defaultValue: 2,
      },
      priority_score: {
        type: Sequelize.TINYINT.UNSIGNED,
        allowNull: false,
        defaultValue: 50,
      },
      pillar_blog_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
        references: { model: 'blogs', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('keyword_clusters', ['head_keyword'], {
      name: 'kc_head_keyword_idx',
    });
    await queryInterface.addIndex('keyword_clusters', ['status'], {
      name: 'kc_status_idx',
    });

    // --- cluster_keywords ---------------------------------------------------
    await queryInterface.createTable('cluster_keywords', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      cluster_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'keyword_clusters', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      keyword: {
        type: Sequelize.STRING(500),
        allowNull: false,
      },
      search_intent: {
        type: Sequelize.ENUM('informational', 'commercial', 'transactional', 'navigational'),
        allowNull: false,
        defaultValue: 'informational',
      },
      suggested_publish_date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      sequence_order: {
        type: Sequelize.TINYINT.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
      },
      assigned_blog_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
        references: { model: 'blogs', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      status: {
        type: Sequelize.ENUM('pending', 'scheduled', 'generating', 'published'),
        allowNull: false,
        defaultValue: 'pending',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('cluster_keywords', ['cluster_id'], {
      name: 'ckw_cluster_id_idx',
    });
    await queryInterface.addIndex('cluster_keywords', ['assigned_blog_id'], {
      name: 'ckw_assigned_blog_id_idx',
    });
    await queryInterface.addIndex('cluster_keywords', ['status'], {
      name: 'ckw_status_idx',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('cluster_keywords');
    await queryInterface.dropTable('keyword_clusters');
  },
};
