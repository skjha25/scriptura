'use strict';

/**
 * P1-A: adds the human-decision fields to `agent_recommendations` — who
 * approved/rejected it and when. Additive and reversible: both columns are
 * nullable, every existing row (all currently `status:'recommended'`) simply
 * has `decided_by`/`decided_at` = NULL after this runs, which is exactly
 * correct (nothing has been decided on them yet). No existing column is
 * touched, no data is rewritten.
 *
 * Deliberately NOT adding a new agent_activity event type/migration for
 * this — the recommendation row itself is already the durable, queryable
 * record of the decision (see the P1 design report), so a second audit
 * write would just duplicate what `decided_by`/`decided_at` already capture.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('agent_recommendations', 'decided_by', {
      type: Sequelize.BIGINT.UNSIGNED,
      allowNull: true,
      // The real table is `users_scriptura` (see 20260730120000-rename-users-to-scriptura.js) — `users` doesn't exist.
      references: { model: 'users_scriptura', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });
    await queryInterface.addColumn('agent_recommendations', 'decided_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('agent_recommendations', 'decided_by');
    await queryInterface.removeColumn('agent_recommendations', 'decided_at');
  },
};
