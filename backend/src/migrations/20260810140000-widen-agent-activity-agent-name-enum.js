'use strict';

/**
 * Widens `agent_activity.agent_name` to include the 5 new Phase 2 agents.
 *
 * MySQL ENUM columns can't be widened via `queryInterface.changeColumn` with
 * a DataTypes.ENUM portably across sequelize-cli versions, so this uses a raw
 * `ALTER TABLE ... MODIFY COLUMN` — the standard approach for enum widening.
 *
 * Silent-failure risk this exists to prevent: `agentActivityLogger.js` is
 * fire-and-forget (a logging failure must never break a chat turn), so an
 * agent name missing from this enum would not error loudly — it would just
 * silently produce zero audit rows for that agent. Widen this BEFORE
 * registering any of the 5 new agents.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(
      `ALTER TABLE agent_activity MODIFY COLUMN agent_name ENUM(
        'blog_image_agent',
        'generate_agent',
        'chief_agent',
        'seo_analyst_agent',
        'blog_ops_agent',
        'cluster_agent',
        'research_agent',
        'autopilot_agent'
      ) NOT NULL`
    );
  },

  down: async (queryInterface, Sequelize) => {
    // Narrowing back is only safe if no row uses a Phase 2 agent name — left
    // as a manual/verified step rather than an automatic down, since a blind
    // narrow could silently drop/corrupt rows that reference the new values.
    await queryInterface.sequelize.query(
      `ALTER TABLE agent_activity MODIFY COLUMN agent_name ENUM(
        'blog_image_agent',
        'generate_agent',
        'chief_agent'
      ) NOT NULL`
    );
  },
};
