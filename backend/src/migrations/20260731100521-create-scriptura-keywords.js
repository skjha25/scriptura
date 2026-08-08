'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('scriptura_keywords', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      primary_keyword: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      secondary_keywords: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      search_intent: {
        type: Sequelize.ENUM('informational', 'transactional', 'navigational'),
        defaultValue: 'informational',
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('not_used', 'in_progress', 'used'),
        defaultValue: 'not_used',
        allowNull: false,
      },
      serp_data: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      used_in_blog_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
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

    await queryInterface.addIndex('scriptura_keywords', ['primary_keyword']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('scriptura_keywords');
  }
};
