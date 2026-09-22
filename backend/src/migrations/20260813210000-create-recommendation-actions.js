'use strict';

/**
 * Creates `recommendation_actions` — P1-B: the human-tracked execution
 * record for an already-approved `agent_recommendations` row.
 *
 * Deliberately a separate table from `agent_recommendations` (see the P1-B
 * design report, §3): a recommendation's own row can't hold multiple
 * execution attempts' history without overwriting it, and this table needs
 * to be a genuinely retriable, mutable-entity (`pending -> completed |
 * failed | cancelled`) the way `agent_recommendations` itself already is —
 * unlike `agent_activity`, which is immutable by construction and can't
 * represent "pending" becoming "completed" on the same row.
 *
 * P1-B SCOPE: no executor writes to this table. Every row this phase
 * creates is `executor_type='manual'`, written by a human admin clicking
 * Start/Complete/Fail/Cancel. `executor_type='automated'` is reserved for a
 * future execution adapter phase, not implemented here.
 *
 * `recommendation_id` is a REAL, constrained FK (unlike the `constraints:
 * false` posture used for User references elsewhere) because an action row
 * has no meaning without its parent recommendation — this is an owned
 * child, not an audit-adjacent reference. ON DELETE RESTRICT: no delete
 * path exists for `agent_recommendations` today, but if one is ever added,
 * it must not silently orphan/discard execution history.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('recommendation_actions', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      recommendation_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'agent_recommendations', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      // App-level convention list (see services/agents/recommendationActions.js),
      // not a DB ENUM — recommend_seo_action has no structured action-type
      // taxonomy today (see design report §6), so an ENUM here would mean
      // guessing at future domains. Mirrors agent_recommendations.recommendation_type,
      // which made the same STRING(100)-not-ENUM choice one table over.
      action_type: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('pending', 'completed', 'failed', 'cancelled'),
        allowNull: false,
        defaultValue: 'pending',
      },
      // 'automated' is reserved, unwritten by any code in this phase — see
      // the header comment.
      executor_type: {
        type: Sequelize.ENUM('manual', 'automated'),
        allowNull: false,
        defaultValue: 'manual',
      },
      // Who actually did/reported the work — may differ from
      // agent_recommendations.decided_by (the approver). Same constraints:false
      // + SET NULL/CASCADE posture as every other audit-adjacent User
      // reference (decided_by, created_by, etc.) — the real FK lives here.
      executed_by: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
        references: { model: 'users_scriptura', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      // Explicit, not inferred from row order — incremented by the service
      // layer as (MAX(attempt_number) for this recommendation_id) + 1 each
      // time a new action is created for an already-attempted recommendation.
      attempt_number: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      // Optional human-entered detail about what was actually done. Generic
      // JSON, no SEO-specific shape — see the design report §7.
      parameters: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      result_summary: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      error: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      // Denormalized copy of the parent recommendation's trace_id, for
      // convenient single-table querying — not a new source of truth (the
      // real value always lives on agent_recommendations).
      trace_id: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      completed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      // Mutable-entity convention, matching agent_recommendations (not
      // agent_activity's immutable no-updated_at posture) — this row's
      // status is expected to change from pending to a terminal state.
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('recommendation_actions', ['recommendation_id'], { name: 'ra_recommendation_id_idx' });
    await queryInterface.addIndex('recommendation_actions', ['status'], { name: 'ra_status_idx' });
    await queryInterface.addIndex('recommendation_actions', ['action_type'], { name: 'ra_action_type_idx' });
    await queryInterface.addIndex('recommendation_actions', ['trace_id'], { name: 'ra_trace_id_idx' });
    // Composite: "is there already a pending action for this recommendation"
    // is exactly a 2-column filter — same reasoning as serp_snapshots' composite
    // dedup-lookup index.
    await queryInterface.addIndex('recommendation_actions', ['recommendation_id', 'status'], {
      name: 'ra_recommendation_status_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('recommendation_actions');
  },
};
