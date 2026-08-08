'use strict';

/**
 * Creates the `scriptura_logs` table — persistent activity log for the entire
 * blog generation lifecycle.
 *
 * Every generation event (queued, started, completed, failed), autopilot
 * trigger, and scheduled publish is recorded here for monitoring and audit.
 * Logs are append-only (no updatedAt) and never deleted by the application.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('scriptura_logs', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      blog_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
      },
      cluster_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
      },
      keyword_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
      },
      event_type: {
        type: Sequelize.ENUM(
          'generation_queued',
          'generation_started',
          'generation_completed',
          'generation_failed',
          'autopilot_triggered',
          'autopilot_blog_created',
          'autopilot_skipped',
          'autopilot_retry',
          'scheduled_publish',
          'publish_skipped',
          'reap_stale'
        ),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('success', 'failure', 'warning', 'info'),
        allowNull: false,
        defaultValue: 'info',
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      error_message: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      error_stack: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      duration_ms: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
      },
      word_count: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
      },
      seo_score: {
        type: Sequelize.TINYINT.UNSIGNED,
        allowNull: true,
      },
      aeo_score: {
        type: Sequelize.TINYINT.UNSIGNED,
        allowNull: true,
      },
      geo_score: {
        type: Sequelize.TINYINT.UNSIGNED,
        allowNull: true,
      },
      block_count: {
        type: Sequelize.SMALLINT.UNSIGNED,
        allowNull: true,
      },
      triggered_by: {
        type: Sequelize.ENUM('user', 'autopilot', 'scheduler', 'system'),
        allowNull: false,
        defaultValue: 'system',
      },
      user_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
      },
      provider: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      metadata: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // Indexes for common query patterns
    await queryInterface.addIndex('scriptura_logs', ['blog_id'], { name: 'logs_blog_id_idx' });
    await queryInterface.addIndex('scriptura_logs', ['cluster_id'], { name: 'logs_cluster_id_idx' });
    await queryInterface.addIndex('scriptura_logs', ['keyword_id'], { name: 'logs_keyword_id_idx' });
    await queryInterface.addIndex('scriptura_logs', ['event_type'], { name: 'logs_event_type_idx' });
    await queryInterface.addIndex('scriptura_logs', ['status'], { name: 'logs_status_idx' });
    await queryInterface.addIndex('scriptura_logs', ['created_at'], { name: 'logs_created_at_idx' });
    await queryInterface.addIndex('scriptura_logs', ['triggered_by'], { name: 'logs_triggered_by_idx' });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('scriptura_logs');
  },
};
