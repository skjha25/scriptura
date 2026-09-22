'use strict';

/**
 * Creates `gsc_snapshots` — one row per real Google Search Console Search
 * Analytics response worth keeping, mirroring `serp_snapshots`
 * (20260813120000-create-serp-snapshots.js) exactly: an immutable
 * point-in-time observation, not a live-updated "current performance" record.
 *
 * `site_url` is always the verified property this data came from
 * (divinetalk.in, the product/consultation site) — a DIFFERENT property from
 * whatever `serp_snapshots.location` tracks for divinetalk.in (the blog/
 * content site). The two are never merged into one table or one row shape,
 * so a reader can never mistake one property's data for the other's.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('gsc_snapshots', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      site_url: {
        type: Sequelize.STRING(255),
        allowNull: false,
        comment: 'The verified GSC property this snapshot came from, e.g. "sc-domain:divinetalk.in".',
      },
      date_range_start: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      date_range_end: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      dimensions: {
        type: Sequelize.JSON,
        allowNull: false,
        comment: 'Ordered dimension list requested, e.g. ["query","page","date"] — matches gsc_rows column meaning.',
      },
      fetched_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      provider: {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: 'gsc',
      },
      source_function: {
        type: Sequelize.STRING(32),
        allowNull: false,
        comment: 'Which gsc.js function produced this snapshot (fetchSearchAnalytics).',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('gsc_snapshots', ['site_url', 'date_range_start', 'date_range_end'], {
      name: 'gsc_snapshots_identity_idx',
    });
    await queryInterface.addIndex('gsc_snapshots', ['created_at'], { name: 'gsc_snapshots_created_at_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('gsc_snapshots');
  },
};
