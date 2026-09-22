'use strict';

/**
 * Creates `recommendation_outcomes` — P2-A: the deferred, deterministic
 * measurement of whether an already-executed `recommendation_actions` row
 * actually moved the metric its parent recommendation was about.
 *
 * Deliberately a separate table from `recommendation_actions`, not an
 * extension of it: `recommendation_actions.result_summary` already captures
 * synchronous content-mutation evidence (before/after field values) at
 * execution time — that is never duplicated here. What this table adds is a
 * *time-delayed* observation (SERP position / GSC clicks/impressions/CTR)
 * captured on a schedule independent of when the action itself completed,
 * which no existing column or table models.
 *
 * `action_id` is UNIQUE (not `recommendation_id`) because a retried action
 * attempt gets its own row in `recommendation_actions` and can earn its own
 * outcome — this table follows attempts, not recommendations.
 *
 * `observation_window_days` is populated by snapshotting
 * `agent_recommendations.observation_window_days` at row-creation time (see
 * services/agents/outcomeMeasurement.js) — that column has existed since P0
 * but nothing has ever read it until this table's writer does.
 *
 * `outcome`/`metric_deltas` are deterministic, code-computed only.
 * `outcome_reasoning` is a deliberately separate, optional, LLM-authored
 * narrative column — it can never influence the classification or the
 * numbers, only gloss them for a human reader.
 *
 * Both FKs use ON DELETE RESTRICT, matching `recommendation_actions.
 * recommendation_id`'s own posture: no delete path exists for
 * `agent_recommendations`/`recommendation_actions` today, but if one is ever
 * added it must not silently discard measurement history.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('recommendation_outcomes', {
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
      action_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        unique: true,
        references: { model: 'recommendation_actions', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      baseline_captured_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      // [{type:'serp_snapshot'|'gsc_snapshot', id}] — pointers only, never
      // copied metric data. Same "evidence is pointers only" convention as
      // sharedRecommendationTools.js's evidence_refs, except these are
      // written exclusively by deterministic code (outcomeMeasurement.js),
      // never LLM-supplied.
      baseline_evidence_refs: {
        type: Sequelize.JSON,
        allowNull: false,
      },
      // Snapshotted from agent_recommendations.observation_window_days at
      // creation time (with a config-driven fallback when that column is
      // null) — not read live later, since a completed action's parent
      // recommendation is never reopened.
      observation_window_days: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      due_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('pending', 'evaluated', 'inconclusive'),
        allowNull: false,
        defaultValue: 'pending',
      },
      fresh_evidence_refs: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      // [{metric, baseline, fresh, delta}] — deterministic, code-computed
      // only. Never written by an LLM call.
      metric_deltas: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      // Deterministic classification, judged against the one metric the
      // recommending agent actually named (expected_metric/expected_direction
      // on the parent recommendation) — never a causal claim, and never
      // picked post-hoc from among several collected metrics.
      outcome: {
        type: Sequelize.ENUM('improved', 'declined', 'neutral', 'inconclusive'),
        allowNull: true,
      },
      // Optional LLM-authored narrative gloss over the already-computed
      // metric_deltas/outcome above — deliberately a separate column so it
      // can never be the source of the classification or numbers themselves.
      outcome_reasoning: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      // Bounds retry when fresh evidence is temporarily unresolvable (GSC's
      // processing lag, a disabled integration, a keyword that dropped out
      // of results) — after a configured max, the row terminalizes as
      // status/outcome:'inconclusive' rather than retrying forever.
      evaluation_attempts: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      evaluated_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('recommendation_outcomes', ['recommendation_id'], {
      name: 'ro_recommendation_id_idx',
    });
    // The scheduler's own due-row query is exactly this 2-column filter —
    // same reasoning as recommendation_actions' composite
    // (recommendation_id, status) index.
    await queryInterface.addIndex('recommendation_outcomes', ['status', 'due_at'], {
      name: 'ro_status_due_at_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('recommendation_outcomes');
  },
};
