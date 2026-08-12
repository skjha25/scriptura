'use strict';

/**
 * Widens `agent_activity.event_type` to include `chat_cleared` — the marker
 * row a "Clear chat" click writes so the widget's history-reload endpoint
 * knows to stop reconstructing a thread before that point. Nothing is ever
 * deleted from this table (see the create-agent-activity migration's "never
 * deleted by the application" note); a clear is just a cutoff marker.
 *
 * Same raw ALTER TABLE approach as the agent_name widening migration —
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
        'error',
        'final_reply',
        'chat_cleared'
      ) NOT NULL`
    );
  },

  down: async (queryInterface, Sequelize) => {
    // Narrowing back is only safe if no row uses 'chat_cleared' — left as a
    // manual/verified step rather than an automatic down, same reasoning as
    // the agent_name widening migration's down().
    await queryInterface.sequelize.query(
      `ALTER TABLE agent_activity MODIFY COLUMN event_type ENUM(
        'user_message',
        'delegation',
        'tool_call',
        'setting_proposed',
        'setting_applied',
        'setting_reverted',
        'error',
        'final_reply'
      ) NOT NULL`
    );
  },
};
