'use strict';

const { DataTypes } = require('sequelize');
const { SETTINGS_SCOPE } = require('../constants');

module.exports = (sequelize) => {
  const ScripturaSettings = sequelize.define(
    'ScripturaSettings',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      scope: {
        type: DataTypes.ENUM(...Object.values(SETTINGS_SCOPE)),
        allowNull: false,
        defaultValue: SETTINGS_SCOPE.ORG,
      },
      user_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      setting_key: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
          notEmpty: { msg: 'setting_key cannot be empty.' },
        },
      },
      setting_value: {
        type: DataTypes.JSON,
        allowNull: false,
      },
    },
    {
      tableName: 'scriptura_settings',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      underscored: true,
      freezeTableName: true,
      indexes: [
        {
          name: 'ss_scope_user_key_unique',
          unique: true,
          fields: ['scope', 'user_id', 'setting_key'],
        },
      ],
    }
  );

  // =========================================================================
  // Static helpers — KV store interface
  // =========================================================================

  /**
   * Get a setting value with org → user fallback.
   *
   * Lookup order:
   *   1. User-scoped value (if userId provided)
   *   2. Org-scoped default
   *   3. Provided fallback
   *
   * @param {string} key
   * @param {object} [options]
   * @param {number|null} [options.userId] - User to look up user-scope for
   * @param {*} [options.fallback] - Default if neither scope has the key
   * @returns {Promise<*>} The setting_value (already parsed from JSON)
   */
  ScripturaSettings.getValue = async function getValue(key, { userId = null, fallback = null } = {}) {
    // Try user-scope first
    if (userId) {
      const userSetting = await ScripturaSettings.findOne({
        where: { scope: SETTINGS_SCOPE.USER, user_id: userId, setting_key: key },
      });
      if (userSetting) return userSetting.setting_value;
    }

    // Fall back to org-scope
    const orgSetting = await ScripturaSettings.findOne({
      where: { scope: SETTINGS_SCOPE.ORG, user_id: null, setting_key: key },
    });
    if (orgSetting) return orgSetting.setting_value;

    return fallback;
  };

  /**
   * Set a setting value (upsert semantics).
   *
   * @param {string} key
   * @param {*} value - Will be stored as JSON
   * @param {object} [options]
   * @param {string} [options.scope] - 'org' or 'user'
   * @param {number|null} [options.userId] - Required when scope is 'user'
   */
  ScripturaSettings.setValue = async function setValue(key, value, { scope = SETTINGS_SCOPE.ORG, userId = null } = {}) {
    const where = {
      scope,
      user_id: scope === SETTINGS_SCOPE.USER ? userId : null,
      setting_key: key,
    };

    const [setting, created] = await ScripturaSettings.findOrCreate({
      where,
      defaults: { ...where, setting_value: value },
    });

    if (!created) {
      setting.setting_value = value;
      await setting.save();
    }

    return setting;
  };

  /**
   * Get all settings for a scope (optionally filtered by key prefix).
   *
   * @param {object} [options]
   * @param {string} [options.scope]
   * @param {number|null} [options.userId]
   * @param {string} [options.prefix] - Filter keys starting with this prefix
   * @returns {Promise<Object>} Key-value map
   */
  ScripturaSettings.getAll = async function getAll({ scope = SETTINGS_SCOPE.ORG, userId = null, prefix = '' } = {}) {
    const { Op } = require('sequelize');
    const where = {
      scope,
      user_id: scope === SETTINGS_SCOPE.USER ? userId : null,
    };
    if (prefix) {
      where.setting_key = { [Op.like]: `${prefix}%` };
    }

    const rows = await ScripturaSettings.findAll({ where });
    return rows.reduce((acc, row) => {
      acc[row.setting_key] = row.setting_value;
      return acc;
    }, {});
  };

  return ScripturaSettings;
};
