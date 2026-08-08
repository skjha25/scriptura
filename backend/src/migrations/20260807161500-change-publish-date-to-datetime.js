'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('blogs', 'publish_date', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    
    await queryInterface.changeColumn('cluster_keywords', 'suggested_publish_date', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('blogs', 'publish_date', {
      type: Sequelize.DATEONLY,
      allowNull: true,
    });
    
    await queryInterface.changeColumn('cluster_keywords', 'suggested_publish_date', {
      type: Sequelize.DATEONLY,
      allowNull: true,
    });
  }
};
