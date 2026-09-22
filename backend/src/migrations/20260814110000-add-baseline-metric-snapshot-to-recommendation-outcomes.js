'use strict';

/**
 * P2-B: adds `baseline_metric_snapshot` to `recommendation_outcomes`.
 *
 * P2-A's `baseline_evidence_refs` is a pointer array only
 * (`[{type, id}]`) — it deliberately never duplicates raw SERP/GSC row
 * data. But without a small set of already-computed numbers alongside those
 * pointers, later evaluation (P2-C, not built here) would have no
 * self-describing anchor for "what was baseline actually measured as"
 * without re-deriving it from the referenced snapshot every time.
 *
 * `baseline_metric_snapshot` closes that gap with the same "minimal derived
 * scalar, not raw data" posture `recommendation_actions.result_summary`
 * already uses for its own before/after values — an array of
 * `{metric, value}` pairs (e.g. `{metric:'serp_position', value:5}`), never
 * a copy of an entire SerpResult/GscRow. NOT NULL, matching
 * `baseline_evidence_refs`'s own posture: services/agents/outcomeMeasurement.js
 * only ever creates a row once at least one metric has actually resolved, so
 * an empty/absent value here would be a bug, not a legitimate state.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('recommendation_outcomes', 'baseline_metric_snapshot', {
      type: Sequelize.JSON,
      allowNull: false,
      // Existing rows: none (P2-A shipped with the table empty) — this
      // default is here purely to satisfy NOT NULL on the ALTER itself, not
      // because any real row is expected to have needed a backfill.
      defaultValue: [],
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('recommendation_outcomes', 'baseline_metric_snapshot');
  },
};
