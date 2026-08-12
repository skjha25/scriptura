'use strict';

/**
 * Widens `agent_activity.event_type` to include `setting_dismissed` —
 * Knowledge Layer v2's fix for a real gap the audit found: clicking Dismiss
 * on a proposed change (AgentChatWidget.js's handleDismiss) only ever
 * updated local UI state, never wrote anything, so "explicitly rejected"
 * and "not reviewed yet" were indistinguishable in the audit log. This is
 * the stated prerequisite for eventually letting Chief Agent learn from
 * delegation outcomes — logging infrastructure only, not outcome learning
 * itself (not built in this phase).
 *
 * Same raw ALTER TABLE approach as the two prior widening migrations —
 * MySQL ENUM columns can't be widened portably via queryInterface.changeColumn.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(
      `ALTER TABLE agent_activity MODIFY COLUMN event_type ENUM(
        'user_message',
        'delegation',
        'tool_call',
        'setting_proposed',
        'setting_applied',
        'setting_reverted',
        'setting_dismissed',
        'error',
        'final_reply',
        'chat_cleared'
      ) NOT NULL`
    );
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(
      `ALTER TABLE agent_activity MODIFY COLUMN event_type ENUM(
        'user_message',
        'delegation',
        'tool_call',
        'setting_proposed',
        'setting_applied',
        'setting_reverted',
        'error',
        'final_reply',
        'chat_cleared'
      ) NOT NULL`
    );
  },
};
