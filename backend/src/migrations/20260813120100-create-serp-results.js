'use strict';

/**
 * Creates `serp_results` — the organic result rows belonging to one
 * `serp_snapshots` row. Deliberately NOT limited to "our own ranking": every
 * organic result the provider returned is persisted, because competitor
 * comparison (ours vs. Astrotalk vs. everyone else) needs the full list, not
 * just the row that happens to match our domain.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('serp_results', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      snapshot_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'serp_snapshots', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      position: {
        type: Sequelize.INTEGER,
        allowNull: false,
        comment: "The provider's true SERP position (ads/features excluded, so this is not the array index).",
      },
      title: {
        type: Sequelize.STRING(512),
        allowNull: true,
      },
      url: {
        type: Sequelize.STRING(2048),
        allowNull: true,
      },
      domain: {
        type: Sequelize.STRING(255),
        allowNull: true,
        comment: 'Hostname with a leading "www." stripped — the comparable unit for competitor matching.',
      },
      snippet: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      result_type: {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: 'organic',
      },
      serp_feature: {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: 'Set when this result is itself a SERP feature (e.g. rich_snippet), null for a plain organic row.',
      },
      metadata: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: 'Extra provider fields worth keeping (displayed_link, redirect_link, favicon, about_this_result).',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('serp_results', ['snapshot_id', 'position'], {
      name: 'serp_results_snapshot_position_idx',
    });
    await queryInterface.addIndex('serp_results', ['domain'], { name: 'serp_results_domain_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('serp_results');
  },
};
