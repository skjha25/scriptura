'use strict';

/**
 * Creates the `users` table — Divinetalk team members who can sign in.
 *
 * No organization_id: this is a single-organisation internal tool and
 * multi-tenancy is explicitly out of scope (see ARCHITECTURE.md).
 *
 * Written with portable Sequelize DataTypes and no raw SQL so that
 * tests/unit/migration-parity.test.js can execute it against in-memory SQLite
 * and diff the resulting schema against the model definitions.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'users',
      {
        id: {
          type: Sequelize.BIGINT.UNSIGNED,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },
        name: {
          type: Sequelize.STRING(150),
          allowNull: false,
        },
        email: {
          type: Sequelize.STRING(255),
          allowNull: false,
          comment: 'Lowercased on write; the login identifier.',
        },
        password_hash: {
          type: Sequelize.STRING(255),
          allowNull: false,
          comment: 'bcrypt hash. Never selected by default (model defaultScope excludes it).',
        },
        role: {
          type: Sequelize.STRING(20),
          allowNull: false,
          defaultValue: 'editor',
          comment: 'admin | editor',
        },
        is_active: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
          comment: 'Deactivate rather than delete, to preserve article attribution.',
        },
        last_login_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        token_version: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 0,
          comment:
            'Embedded in refresh tokens; incrementing it revokes all outstanding tokens for this user.',
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
        },
      },
      {
        // Ignored by SQLite, applied by MySQL. utf8mb4 so names with non-Latin
        // characters round-trip correctly.
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
        engine: 'InnoDB',
      }
    );

    await queryInterface.addIndex('users', {
      name: 'users_email_unique',
      fields: ['email'],
      unique: true,
    });
  },

  async down(queryInterface) {
    // dropTable removes the table's indexes with it.
    await queryInterface.dropTable('users');
  },
};
