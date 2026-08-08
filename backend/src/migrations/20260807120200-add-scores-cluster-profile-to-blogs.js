'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('blogs', 'aeo_score', {
      type: Sequelize.TINYINT.UNSIGNED,
      allowNull: true,
      after: 'seo_score',
    });

    await queryInterface.addColumn('blogs', 'aeo_score_breakdown', {
      type: Sequelize.JSON,
      allowNull: true,
      after: 'aeo_score',
    });

    await queryInterface.addColumn('blogs', 'geo_score', {
      type: Sequelize.TINYINT.UNSIGNED,
      allowNull: true,
      after: 'aeo_score_breakdown',
    });

    await queryInterface.addColumn('blogs', 'geo_score_breakdown', {
      type: Sequelize.JSON,
      allowNull: true,
      after: 'geo_score',
    });

    await queryInterface.addColumn('blogs', 'cluster_id', {
      type: Sequelize.BIGINT.UNSIGNED,
      allowNull: true,
      references: { model: 'keyword_clusters', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
      after: 'geo_score_breakdown',
    });

    await queryInterface.addColumn('blogs', 'optimization_profile', {
      type: Sequelize.STRING(20),
      allowNull: true,
      defaultValue: 'balanced',
      after: 'cluster_id',
    });

    await queryInterface.addIndex('blogs', ['cluster_id'], {
      name: 'blogs_cluster_id_idx',
    });
  },

  down: async (queryInterface) => {
    const tableInfo = await queryInterface.getForeignKeyReferencesForTable('blogs');
    const fk = tableInfo.find((t) => t.columnName === 'cluster_id');
    if (fk) {
      await queryInterface.removeConstraint('blogs', fk.constraintName);
    }
    
    await queryInterface.removeIndex('blogs', 'blogs_cluster_id_idx');
    await queryInterface.removeColumn('blogs', 'optimization_profile');
    await queryInterface.removeColumn('blogs', 'cluster_id');
    await queryInterface.removeColumn('blogs', 'geo_score_breakdown');
    await queryInterface.removeColumn('blogs', 'geo_score');
    await queryInterface.removeColumn('blogs', 'aeo_score_breakdown');
    await queryInterface.removeColumn('blogs', 'aeo_score');
  },
};
