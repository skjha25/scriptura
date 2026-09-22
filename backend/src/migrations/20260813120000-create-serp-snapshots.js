'use strict';

/**
 * Creates `serp_snapshots` — one row per real SerpAPI call whose response was
 * worth keeping. Until now `services/serp.js` fetched real SERP data and threw
 * it away after mapping it into a caller-specific shape (a rank-check number,
 * or a trimmed grounding brief); nothing else could see the full organic list.
 *
 * A row here is an immutable point-in-time observation, not a live-updated
 * "current rank" record — `checkRank`/`fetchSerpDataForKeyword` keep writing
 * their existing outputs (blog rank fields, the grounding brief) exactly as
 * before. This table is purely additive evidence for later reads (the SEO
 * Analyst tool, and eventually rank-movement-over-time analysis).
 *
 * Portable DataTypes and queryInterface calls only, no raw SQL, so this also
 * runs cleanly against the in-memory SQLite the test suite uses.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('serp_snapshots', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      keyword: {
        type: Sequelize.STRING(255),
        allowNull: false,
        comment: 'Query exactly as sent to the provider.',
      },
      normalized_keyword: {
        type: Sequelize.STRING(255),
        allowNull: false,
        comment: 'Lowercased, whitespace-collapsed keyword — the dedup/lookup key.',
      },
      location: {
        type: Sequelize.STRING(8),
        allowNull: false,
        comment: 'Google `gl` country code, e.g. "in".',
      },
      language: {
        type: Sequelize.STRING(8),
        allowNull: false,
        comment: 'Google `hl` language code, e.g. "en".',
      },
      device: {
        type: Sequelize.STRING(16),
        allowNull: false,
        defaultValue: 'desktop',
      },
      provider: {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: 'serpapi',
      },
      searched_at: {
        type: Sequelize.DATE,
        allowNull: false,
        comment: 'When the provider processed the search (its search_metadata timestamp).',
      },
      total_results: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
        comment: "Google's own estimated total result count, if the provider reports one.",
      },
      serp_features: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: 'Which SERP features this response had: PAA, related searches, AI overview, etc.',
      },
      normalized_payload: {
        type: Sequelize.JSON,
        allowNull: true,
        comment:
          'Safe subset of the raw provider response (search metadata/parameters/information) ' +
          'for future analysis without another paid API call. Never contains the API key.',
      },
      source_function: {
        type: Sequelize.STRING(32),
        allowNull: false,
        comment: 'Which serp.js function produced this snapshot (checkRank | fetchSerpDataForKeyword).',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('serp_snapshots', ['normalized_keyword', 'location', 'language', 'device'], {
      name: 'serp_snapshots_identity_idx',
    });
    await queryInterface.addIndex('serp_snapshots', ['searched_at'], { name: 'serp_snapshots_searched_at_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('serp_snapshots');
  },
};
