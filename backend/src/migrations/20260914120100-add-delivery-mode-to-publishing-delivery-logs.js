'use strict';

/**
 * Records whether a delivery attempt created the client's post or updated an
 * existing one (see 20260914120000-add-update-endpoint-to-publishing-integrations.js).
 * Existing rows were all creates, so the default backfills them correctly.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('publishing_delivery_logs', 'delivery_mode', {
      type: Sequelize.ENUM('create', 'update'),
      allowNull: false,
      defaultValue: 'create',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('publishing_delivery_logs', 'delivery_mode');
  },
};
