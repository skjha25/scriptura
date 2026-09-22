'use strict';

/**
 * Creates `publishing_delivery_logs` — one row per attempt to deliver a
 * published blog to a client's external POST endpoint. Structurally modeled
 * on `recommendation_actions` (status enum, attempt tracking, error TEXT,
 * trace_id) — the closest existing precedent for "an action executed
 * against something external, with a retriable result."
 *
 * `blog_id` is a bare, unconstrained column (no FK), matching
 * `scriptura_logs.blog_id`'s existing precedent for a log table's soft
 * reference to a blog — a delivery log must survive regardless of any
 * future change to how blogs are deleted/archived.
 *
 * `integration_id` IS a real constrained FK (RESTRICT) — same reasoning as
 * publishing_field_mappings: no delete-integration path exists in v1.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('publishing_delivery_logs', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      integration_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'publishing_integrations', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      blog_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('pending', 'delivered', 'failed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      http_status: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      attempt_number: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      // Stable across retries of the same publish event — sent as the
      // Idempotency-Key header. A genuinely new publish gets a new key.
      idempotency_key: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      // Field NAMES sent, never values that could be secret-shaped —
      // credentials are never written to this table.
      request_field_names: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      // Capped/truncated at write time (see clientDeliveryService.js) — a
      // debugging aid, not an unbounded response mirror.
      response_summary: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      external_post_id: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      external_url: {
        type: Sequelize.STRING(2048),
        allowNull: true,
      },
      // A safe, categorized message (AUTH_FAILED / INVALID_PAYLOAD /
      // SERVER_ERROR / TIMEOUT / ...) — never a raw exception string that
      // could echo request/credential details.
      error: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      trace_id: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      completed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    await queryInterface.addIndex('publishing_delivery_logs', ['integration_id'], {
      name: 'pdl_integration_id_idx',
    });
    await queryInterface.addIndex('publishing_delivery_logs', ['blog_id'], {
      name: 'pdl_blog_id_idx',
    });
    await queryInterface.addIndex('publishing_delivery_logs', ['status'], {
      name: 'pdl_status_idx',
    });
    await queryInterface.addIndex('publishing_delivery_logs', ['idempotency_key'], {
      name: 'pdl_idempotency_key_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('publishing_delivery_logs');
  },
};
