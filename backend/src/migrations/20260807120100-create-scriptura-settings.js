'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('scriptura_settings', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      scope: {
        type: Sequelize.ENUM('org', 'user'),
        allowNull: false,
        defaultValue: 'org',
      },
      user_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
        references: { model: 'users_scriptura', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      setting_key: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      setting_value: {
        type: Sequelize.JSON,
        allowNull: false,
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

    // Unique constraint: one value per (scope, user_id, key) combination.
    // user_id is NULL for org-scope settings.
    await queryInterface.addIndex('scriptura_settings', ['scope', 'user_id', 'setting_key'], {
      name: 'ss_scope_user_key_unique',
      unique: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('scriptura_settings');
  },
};
