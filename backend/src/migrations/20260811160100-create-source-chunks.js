'use strict';

/**
 * Creates `source_chunks` — deterministic char-window chunks of a
 * `knowledge_sources` row (see services/agents/knowledge/knowledgeSourceChunking.js),
 * so a long source can be extracted-from in bounded-size batches instead of
 * being hard-truncated, and so a distilled knowledge claim can point back at
 * the specific chunk(s) that support it (agent_knowledge.chunk_ids).
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('source_chunks', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      source_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'knowledge_sources', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      sequence: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      text: {
        type: Sequelize.TEXT('medium'),
        allowNull: false,
      },
      char_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      // Populated lazily (evidence lookups embed on demand) — see
      // knowledgeEmbedding.js. Chunk-level embeddings are not required for
      // primary retrieval (that's agent_knowledge.embedding); this is only
      // for a future, more precise evidence-passage lookup.
      embedding: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('source_chunks', ['source_id', 'sequence'], { name: 'sc_source_sequence_idx' });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('source_chunks');
  },
};
