'use strict';

/**
 * P6-B: adds `fact_verification` to `blogs`.
 *
 * Nullable JSON, additive only. Populated by the new
 * services/factVerification.js step (wired into services/generation.js,
 * between article generation and blocksToHtml) ONLY when the org has at
 * least one active configured fact source — every existing blog, and every
 * future blog generated with no fact sources configured, simply has
 * `fact_verification: null`, which the frontend must treat as "verification
 * was not run for this article," never as "verified."
 *
 * Shape (informational — never enforced at the DB layer, same posture as
 * every other JSON column in this schema):
 *   {
 *     status: 'verified'|'conflict'|'unverified'|'not_applicable',
 *     checkedAt: ISO string,
 *     policy: 'primary_only'|'compare_all'|'primary_plus_conflict_warning',
 *     claims: [{ claim, status, sourceName, sourceId, conflictDetail }],
 *   }
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('blogs', 'fact_verification', {
      type: Sequelize.JSON,
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('blogs', 'fact_verification');
  },
};
