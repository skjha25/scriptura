'use strict';

/**
 * Adds `image_count` to `keyword_clusters`.
 *
 * Nullable TINYINT, additive only. When null, autopilot generation falls
 * back to 2 (see services/autopilotScheduler.js) — the same value it
 * hardcoded before this column existed, so every existing cluster keeps
 * generating exactly as before.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('keyword_clusters', 'image_count', {
      type: Sequelize.TINYINT.UNSIGNED,
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('keyword_clusters', 'image_count');
  },
};
