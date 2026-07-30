'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('users') && !tables.includes('users_scriptura')) {
      await queryInterface.renameTable('users', 'users_scriptura');
      // Sequelize uses the table name for the index, but we might want to rename it too
      try {
        await queryInterface.removeIndex('users_scriptura', 'users_email_unique');
        await queryInterface.addIndex('users_scriptura', {
          name: 'users_scriptura_email_unique',
          fields: ['email'],
          unique: true,
        });
      } catch (err) {
        // Ignore index rename errors if they don't match
      }
    }
  },

  async down(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('users_scriptura') && !tables.includes('users')) {
      await queryInterface.renameTable('users_scriptura', 'users');
    }
  },
};
