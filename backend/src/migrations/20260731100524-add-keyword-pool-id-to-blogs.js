'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('blogs', 'keyword_pool_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'scriptura_keywords',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('blogs', 'keyword_pool_id');
  }
};
