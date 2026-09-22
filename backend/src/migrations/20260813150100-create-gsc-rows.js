'use strict';

/**
 * Creates `gsc_rows` — the individual Search Analytics rows belonging to one
 * `gsc_snapshots` row, mirroring `serp_results`
 * (20260813120100-create-serp-results.js). Every column here is nullable
 * except the metrics, because GSC returns one value per dimension actually
 * requested — a snapshot fetched with dimensions ["query","page","date"]
 * never populates country/device/search_appearance, and that is a normal,
 * expected shape, not missing data.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('gsc_rows', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      snapshot_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'gsc_snapshots', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      query: {
        type: Sequelize.STRING(512),
        allowNull: true,
      },
      page: {
        type: Sequelize.STRING(2048),
        allowNull: true,
      },
      country: {
        type: Sequelize.STRING(8),
        allowNull: true,
        comment: 'GSC\'s 3-letter ISO country code (e.g. "ind"), when the "country" dimension was requested.',
      },
      device: {
        type: Sequelize.STRING(16),
        allowNull: true,
        comment: 'DESKTOP | MOBILE | TABLET, when the "device" dimension was requested.',
      },
      search_appearance: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      clicks: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      impressions: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      ctr: {
        type: Sequelize.FLOAT,
        allowNull: false,
        defaultValue: 0,
      },
      position: {
        type: Sequelize.FLOAT,
        allowNull: true,
        comment: "GSC's average position for this row over the date range — a float, not a rank integer.",
      },
      date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
        comment: 'Populated only when the "date" dimension was requested for this snapshot.',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('gsc_rows', ['snapshot_id'], { name: 'gsc_rows_snapshot_idx' });
    await queryInterface.addIndex('gsc_rows', ['query'], { name: 'gsc_rows_query_idx' });
    // Prefix index: `page` is STRING(2048), longer than InnoDB's default
    // per-column index-key limit (767 bytes ≈ 191 utf8mb4 chars) — a full-column
    // index here would fail on MySQL, so this indexes only the first 255 bytes.
    await queryInterface.addIndex('gsc_rows', [{ attribute: 'page', length: 255 }], { name: 'gsc_rows_page_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('gsc_rows');
  },
};
