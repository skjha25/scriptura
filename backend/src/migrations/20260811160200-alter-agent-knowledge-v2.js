'use strict';

/**
 * Knowledge Layer v2: adds source-linking, a knowledge-type taxonomy, and an
 * embedding column to `agent_knowledge`, and widens `status` to include
 * 'contested' — every change here is additive/nullable specifically so the
 * 21 real rows this table already has (from the Phase 1-4 build) are never
 * touched in content, only gain new columns defaulted/backfilled safely.
 *
 * `status` is widened via raw `MODIFY COLUMN` (existing 'contradicted' value
 * is KEPT, not replaced, for backward compat with any row already using it —
 * new contradiction-handling code writes 'contested' going forward, per the
 * Knowledge Layer v2 plan) — same enum-widening approach as
 * 20260810140000-widen-agent-activity-agent-name-enum.js.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('agent_knowledge', 'knowledge_type', {
      type: Sequelize.ENUM(
        'fact',
        'strategy',
        'procedure',
        'observation',
        'hypothesis',
        'opinion',
        'guideline',
        'terminology',
        'pattern',
        'source_reliability'
      ),
      allowNull: true,
    });

    await queryInterface.addColumn('agent_knowledge', 'source_id', {
      type: Sequelize.BIGINT.UNSIGNED,
      allowNull: true,
      references: { model: 'knowledge_sources', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });

    await queryInterface.addColumn('agent_knowledge', 'chunk_ids', {
      type: Sequelize.JSON,
      allowNull: true,
    });

    await queryInterface.addColumn('agent_knowledge', 'embedding', {
      type: Sequelize.JSON,
      allowNull: true,
    });

    // Backfill existing rows to a sane default rather than leaving them NULL —
    // NULL would make every pre-v2 row silently invisible to any future
    // knowledge_type filter, which is exactly the kind of drift the retrieval
    // bugs found earlier this session were made of.
    await queryInterface.sequelize.query(
      `UPDATE agent_knowledge SET knowledge_type = 'fact' WHERE knowledge_type IS NULL`
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE agent_knowledge MODIFY COLUMN status ENUM(
        'unverified',
        'supported',
        'confirmed',
        'contradicted',
        'contested',
        'outdated'
      ) NOT NULL DEFAULT 'unverified'`
    );

    await queryInterface.addIndex('agent_knowledge', ['source_id'], { name: 'ak_source_id_idx' });
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('agent_knowledge', 'ak_source_id_idx');
    await queryInterface.sequelize.query(
      `ALTER TABLE agent_knowledge MODIFY COLUMN status ENUM(
        'unverified',
        'supported',
        'confirmed',
        'contradicted',
        'outdated'
      ) NOT NULL DEFAULT 'unverified'`
    );
    await queryInterface.removeColumn('agent_knowledge', 'embedding');
    await queryInterface.removeColumn('agent_knowledge', 'chunk_ids');
    await queryInterface.removeColumn('agent_knowledge', 'source_id');
    await queryInterface.removeColumn('agent_knowledge', 'knowledge_type');
  },
};
