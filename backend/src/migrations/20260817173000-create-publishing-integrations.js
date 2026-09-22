'use strict';

/**
 * Creates `publishing_integrations` — a client's own external POST endpoint
 * + credentials for receiving a copy of every published blog. One row per
 * client integration (DivineTalk today; more later) — deliberately a table,
 * not a singleton config, so onboarding a second client is new data, not a
 * schema change. See the Client Publish-API Integration plan for the full
 * design rationale.
 *
 * `auth_secret_encrypted` holds AES-256-GCM ciphertext only (see
 * services/delivery/credentialCrypto.js) — the plaintext credential never
 * touches this table, and the encryption key itself lives only in
 * CONFIG_ENCRYPTION_KEY (env), never in the database, matching this
 * codebase's existing convention that real secret material stays in env.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('publishing_integrations', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      endpoint_url: {
        type: Sequelize.STRING(2048),
        allowNull: false,
      },
      // Optional — Test Connection sends here instead of endpoint_url when
      // set. Left empty, Test Connection sends to the real endpoint with an
      // explicit confirmation step (see clientDeliveryService.js).
      test_endpoint_url: {
        type: Sequelize.STRING(2048),
        allowNull: true,
      },
      auth_type: {
        type: Sequelize.ENUM('none', 'bearer', 'api_key', 'custom_header'),
        allowNull: false,
        defaultValue: 'none',
      },
      // Header name for api_key/custom_header (e.g. "X-Api-Key"); unused for
      // none/bearer (bearer always sends "Authorization: Bearer <secret>").
      auth_header_name: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      auth_secret_encrypted: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      // Optional dot-paths into the client's JSON response body, e.g.
      // "post.id" / "post.url" — used only to populate
      // publishing_delivery_logs.external_post_id/external_url for display.
      response_id_path: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      response_url_path: {
        type: Sequelize.STRING(255),
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

    await queryInterface.addIndex('publishing_integrations', ['enabled'], {
      name: 'pub_int_enabled_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('publishing_integrations');
  },
};
