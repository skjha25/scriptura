'use strict';

/**
 * One-time backfill: generates embeddings for every `agent_knowledge` row
 * that doesn't have one yet (pre-Knowledge-Layer-v2 rows, or any row an
 * earlier embedding attempt failed for) — so semantic retrieval covers the
 * whole existing knowledge base immediately, not just rows created after
 * this deploy.
 *
 * Safe to re-run: only touches rows where `embedding IS NULL`, and each
 * update is scoped to its own id. Not part of any live request path.
 *
 *     node scripts/backfill-knowledge-embeddings.js
 */

const { AgentKnowledge, sequelize } = require('../src/models');
const { Op } = require('sequelize');
const { embedText } = require('../src/services/agents/knowledge/knowledgeEmbedding');

async function main() {
  const rows = await AgentKnowledge.findAll({ where: { embedding: { [Op.is]: null } } });
  console.log(`Found ${rows.length} row(s) with no embedding.`);

  let succeeded = 0;
  let failed = 0;

  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose: this is a one-off maintenance script, not a hot path, and keeps API rate usage predictable.
    const vector = await embedText(`${row.topic}. ${row.claim}`);
    if (vector) {
      // eslint-disable-next-line no-await-in-loop
      await row.update({ embedding: vector });
      succeeded += 1;
      console.log(`  #${row.id} embedded (${vector.length} dims).`);
    } else {
      failed += 1;
      console.log(`  #${row.id} FAILED — left for a future re-run.`);
    }
  }

  console.log(`Done. ${succeeded} embedded, ${failed} failed.`);
  await sequelize.close();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
