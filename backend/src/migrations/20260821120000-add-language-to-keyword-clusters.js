'use strict';

/**
 * Adds `language` to `keyword_clusters`.
 *
 * Nullable STRING, additive only. When null, autopilot generation falls back
 * to 'en' (see services/autopilotScheduler.js) — every existing cluster keeps
 * generating exactly as before this column existed.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('keyword_clusters', 'language', {
      type: Sequelize.STRING(10),
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('keyword_clusters', 'language');
  },
};
