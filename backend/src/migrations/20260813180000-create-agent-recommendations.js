'use strict';

/**
 * Creates `agent_recommendations` — P0 of the Decision/Outcome/Evaluation
 * architecture (see the design report): a durable, provider-independent
 * record of "an agent suggested X," captured once at the moment a tool
 * returns `{type:'proposed_change'}`, regardless of whether a human ever
 * applies it.
 *
 * Deliberately NOT a copy of `agent_activity`: that table stays the
 * conversational audit trail it already is (unstructured `payload` JSON,
 * immutable, one row per event). This table exists because "show me every
 * recommendation with expected_metric='gsc_impressions' still awaiting
 * review" cannot be answered by scanning `agent_activity.payload` — this
 * table owns the structure that needs to be queryable/joinable.
 *
 * P0 SCOPE: only `status='recommended'` is ever written by this phase.
 * `approved`/`rejected` are reserved in the ENUM for a deliberately deferred
 * follow-up (wiring the existing settingApplied/settingDismissed/applyProposal
 * paths to update this row) — see the design report for why that was left
 * out of this pass rather than silently included.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('agent_recommendations', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      trace_id: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      agent_name: {
        type: Sequelize.ENUM(
          'blog_image_agent',
          'generate_agent',
          'chief_agent',
          'seo_analyst_agent',
          'blog_ops_agent',
          'cluster_agent',
          'research_agent',
          'autopilot_agent'
        ),
        allowNull: false,
      },
      // The agent_activity row for the setting_proposed event this
      // recommendation was captured from. Nullable in the schema (a future
      // capture path might not have one) but always populated by this
      // phase's one call site — see services/agents/recommendations.js.
      // UNIQUE is the idempotency guard: the same proposal event can never
      // produce two recommendation rows.
      source_activity_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
        unique: true,
        references: { model: 'agent_activity', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      // The tool name (e.g. "propose_cluster_status_change") — the one field
      // confirmed 100% present across every proposed_change-returning tool in
      // the codebase today, unlike `change.domain`/`change.action`/`change.key`
      // which are inconsistently present (see the design report's tool audit).
      recommendation_type: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      // The tool's own human-readable `message` string, when present.
      summary: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      // The tool's raw `change` object, verbatim — already structured,
      // provider-neutral JSON (never a raw provider/SDK response), so no
      // lossy field-by-field extraction is needed for P0.
      recommendation_details: {
        type: Sequelize.JSON,
        allowNull: false,
      },
      // Best-effort extracted identifiers (whichever of key/cluster_id/
      // keyword_id/blog_id/block_id/style the tool's change object happened
      // to include) — for convenient filtering without parsing JSON.
      target_ref: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      // Optional prediction fields. Generic on purpose — expected_metric is a
      // free string (e.g. "gsc_impressions" or "blog_seo_score"), never
      // constrained to SEO. No current tool populates these; reserved for
      // when a recommending tool starts expressing a prediction.
      expected_metric: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      expected_direction: {
        type: Sequelize.STRING(20),
        allowNull: true,
      },
      expected_change: {
        type: Sequelize.FLOAT,
        allowNull: true,
      },
      observation_window_days: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      confidence: {
        type: Sequelize.FLOAT,
        allowNull: true,
      },
      // Minimal P0 lifecycle. 'approved'/'rejected' are reserved but unwritten
      // this phase — see the header comment.
      status: {
        type: Sequelize.ENUM('recommended', 'approved', 'rejected'),
        allowNull: false,
        defaultValue: 'recommended',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      // Unlike agent_activity (immutable, no updated_at), this row's status
      // is expected to change later (once approve/reject wiring lands), so
      // this table follows the mutable-entity convention instead.
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('agent_recommendations', ['trace_id'], { name: 'ar_trace_id_idx' });
    await queryInterface.addIndex('agent_recommendations', ['agent_name'], { name: 'ar_agent_name_idx' });
    await queryInterface.addIndex('agent_recommendations', ['status'], { name: 'ar_status_idx' });
    await queryInterface.addIndex('agent_recommendations', ['recommendation_type'], { name: 'ar_recommendation_type_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('agent_recommendations');
  },
};
