'use strict';

/**
 * Creates `learning_candidates` — P4-A: "P4 may IDENTIFY potential
 * learning. P4 must NOT automatically TEACH the system."
 *
 * A learning candidate is a deterministic, code-computed aggregation over
 * already-evaluated `recommendation_outcomes` (P2-B/P2-C) rows — "across N
 * observed outcomes for action_type X, Y% improved the target metric" —
 * awaiting explicit human confirm/reject. It is NEVER written directly into
 * `agent_knowledge`; confirming one calls the existing, unmodified
 * `knowledgeBase.confirmKnowledgeBatch()` (the same function
 * `POST /agents/:agentName/knowledge-base/confirm` already uses for
 * hand-taught knowledge) — one write path for `agent_knowledge`, unchanged
 * by this migration.
 *
 * `scope`/`agent_name` default to 'agent'/non-null — new candidates are
 * NEVER created as scope:'global' (see services/agents/learningCandidates.js).
 * Global is only ever chosen by an explicit human decision at confirm time,
 * via the exact same scope parameter `confirmKnowledgeBatch` already accepts
 * — no new scope-selection UI/mechanism, reusing AgentKnowledgePage.js's
 * existing Global/Agent radio.
 *
 * `pattern_key` deliberately has NO unique DB constraint: a rejected or
 * confirmed candidate for the same pattern is a legitimate historical row,
 * and a stronger/fresher candidate for the same pattern may reasonably be
 * detected again later (more evidence accumulated). Only one *open*
 * (`status:'pending_review'`) candidate per `pattern_key` is enforced, at
 * the application layer (see learningCandidates.js's check-then-create) —
 * the same accepted-risk, no-DB-constraint posture already used for
 * `recommendation_actions`' own "only one pending action per recommendation"
 * guard.
 *
 * `evidence_refs` (JSON, `[{type:'recommendation_outcome', id}]`) are
 * pointers only, written exclusively by the deterministic aggregation code
 * that computed `sample_size`/the count columns in the same transaction —
 * never LLM-supplied, so — unlike sharedRecommendationTools.js's own
 * LLM-facing `evidence_refs` — these are correct by construction and need
 * no separate validation/join-table.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('learning_candidates', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      // Deterministic identity for a detected pattern, e.g.
      // "action_type:seo_analyst_agent:blog.update_seo_fields" — includes
      // the agent so two different agents' patterns for the same
      // action_type never collide (no cross-agent contamination). See the
      // header comment for why this has no unique DB constraint.
      pattern_key: {
        type: Sequelize.STRING(150),
        allowNull: false,
      },
      scope: {
        type: Sequelize.ENUM('global', 'agent'),
        allowNull: false,
        defaultValue: 'agent',
      },
      // NULL only for scope:'global' rows — but no code path in this phase
      // ever creates one; detection always sets both scope:'agent' and a
      // real agent_name together (see learningCandidates.js). Same explicit
      // ENUM literal list as agent_recommendations.agent_name/
      // agent_knowledge.agent_name — migrations hardcode the value list
      // rather than importing constants.js, so a historical migration stays
      // stable even if the app's own agent roster changes later.
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
        allowNull: true,
      },
      // Pre-shaped exactly as confirmKnowledgeBatchBody's items[] entry
      // expects, so confirming a candidate needs no field translation.
      category: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      topic: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      claim: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      // Deterministic, code-generated sentence restating the counts below —
      // never LLM-authored. See `reasoning` for the one column that is.
      evidence: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      // Separate, optional, LLM-authored narrative gloss over the
      // already-computed counts/claim above — same "deterministic facts and
      // LLM prose in different columns" separation already established by
      // recommendation_outcomes.outcome_reasoning (P2-A). Never populated by
      // this phase (P4-C, the LLM-fill-in step, was cut) — always NULL today,
      // column exists so a future pass can add it without a new migration.
      reasoning: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      sample_size: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      improved_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      declined_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      neutral_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      inconclusive_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // Code-computed from the counts above (the improved/declined rate that
      // crossed the detection threshold) — never LLM-set.
      confidence: {
        type: Sequelize.FLOAT,
        allowNull: false,
        defaultValue: 0.5,
      },
      evidence_refs: {
        type: Sequelize.JSON,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('pending_review', 'confirmed', 'rejected'),
        allowNull: false,
        defaultValue: 'pending_review',
      },
      reviewed_by: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
        references: { model: 'users_scriptura', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      reviewed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      // Set only after a successful confirm — points at the real
      // agent_knowledge row confirmKnowledgeBatch actually created.
      confirmed_knowledge_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
        references: { model: 'agent_knowledge', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      // Mutable-entity convention (matches agent_recommendations/
      // recommendation_actions/recommendation_outcomes) — this row's status
      // is expected to change from pending_review to a terminal state.
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('learning_candidates', ['pattern_key'], { name: 'lc_pattern_key_idx' });
    await queryInterface.addIndex('learning_candidates', ['status'], { name: 'lc_status_idx' });
    await queryInterface.addIndex('learning_candidates', ['agent_name'], { name: 'lc_agent_name_idx' });
    // "is there already an open candidate for this pattern" is exactly this
    // 2-column filter — same reasoning as recommendation_actions' own
    // (recommendation_id, status) composite index for its analogous guard.
    await queryInterface.addIndex('learning_candidates', ['pattern_key', 'status'], {
      name: 'lc_pattern_key_status_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('learning_candidates');
  },
};
