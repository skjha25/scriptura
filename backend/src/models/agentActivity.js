'use strict';

const { DataTypes } = require('sequelize');
const { AGENT_NAMES, AGENT_EVENT_TYPES, LOG_STATUS } = require('../constants');

/**
 * AgentActivity — append-only audit trail for the agentic-AI chat layer.
 *
 * Every step of an agent's tool-use loop (user message, tool call, proposed/
 * applied/reverted setting, delegation, final reply) is recorded here, keyed
 * by `trace_id` so a whole chat turn — including a Chief Agent delegation
 * chain — is reconstructable. Logs are immutable (no updatedAt), never
 * soft-deleted, and retained indefinitely for audit and debugging. Reuses
 * `LOG_STATUS` (scriptura_logs' outcome enum) rather than inventing a second
 * success/failure/warning/info enum.
 */
module.exports = (sequelize) => {
  const AgentActivity = sequelize.define(
    'AgentActivity',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      trace_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      agent_name: {
        type: DataTypes.ENUM(...Object.values(AGENT_NAMES)),
        allowNull: false,
      },
      event_type: {
        type: DataTypes.ENUM(...Object.values(AGENT_EVENT_TYPES)),
        allowNull: false,
      },
      from_agent: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      to_agent: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      tool_name: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      setting_key: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM(...Object.values(LOG_STATUS)),
        allowNull: false,
        defaultValue: LOG_STATUS.INFO,
      },
      payload: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      user_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
    },
    {
      tableName: 'agent_activity',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false, // Logs are immutable — no updates.
      underscored: true,
      freezeTableName: true,
      indexes: [
        { name: 'aa_trace_id_idx', fields: ['trace_id'] },
        { name: 'aa_agent_name_idx', fields: ['agent_name'] },
        { name: 'aa_event_type_idx', fields: ['event_type'] },
        { name: 'aa_tool_name_idx', fields: ['tool_name'] },
        { name: 'aa_setting_key_idx', fields: ['setting_key'] },
        { name: 'aa_user_id_idx', fields: ['user_id'] },
        { name: 'aa_created_at_idx', fields: ['created_at'] },
      ],
    }
  );

  return AgentActivity;
};
