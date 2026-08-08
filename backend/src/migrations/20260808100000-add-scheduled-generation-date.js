'use strict';

/**
 * Adds `scheduled_generation_date` to cluster_keywords.
 *
 * This is the datetime at which the autopilot scheduler will automatically
 * trigger blog generation for the keyword. A UNIQUE constraint enforces that
 * no two keywords share the exact same generation time-slot — the same date is
 * fine, but the same date+time is not, so the system never tries to generate
 * two blogs simultaneously.
 *
 * NULL values are exempt from the UNIQUE constraint in MySQL, so keywords
 * without a scheduled date (status = 'pending') coexist without conflict.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('cluster_keywords', 'scheduled_generation_date', {
      type: Sequelize.DATE,
      allowNull: true,
      after: 'suggested_publish_date',
    });

    await queryInterface.addIndex('cluster_keywords', ['scheduled_generation_date'], {
      name: 'ckw_gen_date_unique',
      unique: true,
      where: { scheduled_generation_date: { [Sequelize.Op.ne]: null } },
    });

    // Composite index for the autopilot cron query:
    // WHERE status = 'pending' AND scheduled_generation_date <= NOW()
    await queryInterface.addIndex('cluster_keywords', ['status', 'scheduled_generation_date'], {
      name: 'ckw_status_gen_date_idx',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('cluster_keywords', 'ckw_status_gen_date_idx');
    await queryInterface.removeIndex('cluster_keywords', 'ckw_gen_date_unique');
    await queryInterface.removeColumn('cluster_keywords', 'scheduled_generation_date');
  },
};
