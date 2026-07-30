'use strict';

/**
 * `users` — Divinetalk team members who can sign in.
 *
 * Deliberately minimal. There is no organization_id and no tenant scoping:
 * this is a single-organisation internal tool, and Section 0 of the spec is
 * explicit that multi-tenancy must not be built now. Authorisation is just
 * "is this a logged-in team member, and are they an admin or an editor".
 *
 * `password_hash` is never selected by default (see the defaultScope) so it
 * cannot leak through a careless `res.json(user)`.
 */

const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { USER_ROLES, USER_ROLE_VALUES } = require('../constants');

module.exports = (sequelize) => {
  const User = sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(150),
        allowNull: false,
        validate: {
          notEmpty: { msg: 'name cannot be empty.' },
        },
      },
      // Uniqueness is declared once, in the `indexes` block below.
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
          isEmail: { msg: 'email must be a valid email address.' },
        },
        // Emails are case-insensitive identifiers; normalising on the way in
        // means the login lookup is a plain equality match and cannot be
        // defeated by capitalisation.
        set(value) {
          this.setDataValue('email', typeof value === 'string' ? value.trim().toLowerCase() : value);
        },
      },
      password_hash: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      role: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: USER_ROLES.EDITOR,
        validate: {
          isIn: {
            args: [USER_ROLE_VALUES],
            msg: `role must be one of ${USER_ROLE_VALUES.join(', ')}.`,
          },
        },
      },
      /**
       * Lets an account be switched off without deleting it and orphaning the
       * `published_by` attribution on their articles.
       */
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      last_login_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      /**
       * Bumped on logout and on password change. The value is embedded in
       * issued refresh tokens; a mismatch invalidates every token minted before
       * the bump. This is what makes logout actually revoke a refresh token
       * without needing a server-side token store.
       */
      token_version: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: 'users_scriptura',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      // No soft delete: deactivate via is_active instead, so the paranoid
      // machinery does not silently hide accounts from an admin listing.
      paranoid: false,
      underscored: true,
      freezeTableName: true,
      // Applies to every query that does not explicitly opt out. The login
      // handler uses `User.scope('withPassword')` to get the hash.
      defaultScope: {
        attributes: { exclude: ['password_hash'] },
      },
      scopes: {
        withPassword: { attributes: { include: ['password_hash'] } },
        active: { where: { is_active: true } },
      },
      indexes: [{ name: 'users_scriptura_email_unique', unique: true, fields: ['email'] }],
    }
  );

  /**
   * Hashes a plaintext password. Exposed as a static so the seeders and the
   * (future) user-management endpoints share one cost factor from config.
   */
  User.hashPassword = function hashPassword(plaintext) {
    return bcrypt.hash(plaintext, config.bcryptRounds);
  };

  /**
   * Constant-time password check.
   *
   * Returns false rather than throwing when the record has no hash, so a
   * malformed row cannot 500 the login endpoint.
   */
  User.prototype.verifyPassword = async function verifyPassword(plaintext) {
    const hash = this.getDataValue('password_hash');
    if (!hash || typeof plaintext !== 'string' || plaintext.length === 0) return false;
    return bcrypt.compare(plaintext, hash);
  };

  User.prototype.isAdmin = function isAdmin() {
    return this.role === USER_ROLES.ADMIN;
  };

  /** Shape returned to clients. Never includes the hash. */
  User.prototype.toSafeJSON = function toSafeJSON() {
    return {
      id: Number(this.id),
      name: this.name,
      email: this.email,
      role: this.role,
      is_active: this.is_active,
      last_login_at: this.last_login_at,
      created_at: this.created_at,
    };
  };

  return User;
};
