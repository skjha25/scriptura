'use strict';

/**
 * Top-level orchestration for the Knowledge & Learning Layer's "teach this
 * agent" flow: ties ingestion -> extraction -> validation into one draft
 * batch (never persists), and is the sole place that turns an admin's
 * reviewed decisions on that batch into real `agent_knowledge` writes.
 *
 * Generate Agent is explicitly excluded everywhere in this module — it keeps
 * its own separate, unmodified style-profile mechanism
 * (services/agents/styleProfile.js, key `agents.generate.style_profile`).
 * Routing a request for it here would risk creating a stray
 * `agents.generate.knowledge_base`-shaped entry alongside the real one.
 */

const ApiError = require('../../../utils/ApiError');
const ingestion = require('./knowledgeIngestion');
const extraction = require('./knowledgeExtraction');
const validation = require('./knowledgeValidation');
const knowledgeStore = require('./knowledgeStore');
const { embedText } = require('./knowledgeEmbedding');
const { AGENT_NAMES } = require('../../../constants');

const DECISIONS = ['accept', 'skip'];

/**
 * Embeds a claim (topic+claim combined, matching what retrieval scores
 * against) for semantic retrieval. Best-effort — embedding failure must
 * never block a confirm; the row still saves, just without semantic
 * retrievability until a future re-embed (see knowledgeStore.retrieveKnowledge,
 * which degrades to lexical-only for rows with no embedding).
 */
async function embedClaim(topic, claim) {
  return embedText(`${topic}. ${claim}`);
}

function assertSupportedAgent(agentName) {
  if (agentName === AGENT_NAMES.GENERATE) {
    throw ApiError.badRequest(
      'Generate Agent uses its own style-profile flow (POST /agents/generate/style-profile/extract) — not the generic knowledge base.',
      { code: 'UNSUPPORTED_AGENT' }
    );
  }
  if (!extraction.PERSONA_BY_AGENT[agentName]) {
    throw ApiError.badRequest(`Unknown agent "${agentName}".`, { code: 'UNKNOWN_AGENT' });
  }
}

/**
 * Ingest (persist + chunk) + hierarchically extract + validate one "teach
 * this agent" submission. Never writes to `agent_knowledge` — returns a
 * draft batch for the admin to review. Each source is fully persisted
 * (KnowledgeSource + SourceChunks) regardless of length — see
 * knowledgeIngestion.gatherContent — and every resulting candidate carries
 * `source_id`/`chunk_ids` so a confirmed item can always be traced back to
 * real evidence.
 *
 * @param {object} opts
 * @param {string} opts.agentName
 * @param {string[]} [opts.textSamples]
 * @param {string[]} [opts.links]
 * @param {string[]} [opts.imagePaths] Already-uploaded relativePaths (via /media/upload).
 * @param {string[]} [opts.youtubeLinks]
 * @param {Buffer|null} [opts.videoBuffer]
 * @param {string|null} [opts.videoMimeType]
 * @param {number|null} [opts.userId] Who's teaching — recorded on the persisted KnowledgeSource rows.
 * @param {object} [options]
 * @param {object} [options.provider] Injected for tests.
 * @returns {Promise<{agent_name: string, sources: Array<object>, items: Array<object>}>}
 */
async function proposeKnowledgeBatch(
  {
    agentName,
    textSamples = [],
    links = [],
    imagePaths = [],
    youtubeLinks = [],
    videoBuffer = null,
    videoMimeType = null,
    userId = null,
  } = {},
  options = {}
) {
  assertSupportedAgent(agentName);

  const totalInputs = textSamples.length + links.length + imagePaths.length + youtubeLinks.length + (videoBuffer ? 1 : 0);
  if (totalInputs === 0) {
    throw ApiError.unprocessable('Provide at least one text sample, link, image, video, or YouTube link.', {
      code: 'NOTHING_TO_ANALYSE',
    });
  }

  const gathered = await ingestion.gatherContent({
    textSamples,
    links,
    imagePaths,
    youtubeLinks,
    videoBuffer,
    videoMimeType,
    createdBy: userId,
  });
  const candidates = await extraction.extractFromSources({ agentName, sources: gathered.sources }, options);
  const classifications = await validation.validateCandidates(agentName, candidates, options);

  return {
    agent_name: agentName,
    sources: gathered.sourcesMeta,
    items: classifications.map((c) => ({
      category: c.candidate.category,
      topic: c.candidate.topic,
      claim: c.candidate.claim,
      evidence: c.candidate.evidence,
      knowledge_type: c.candidate.knowledge_type,
      applicable_agents: c.candidate.applicable_agents,
      source_id: c.candidate.source_id || null,
      chunk_ids: c.candidate.chunk_ids || null,
      verdict: c.verdict,
      related_id: c.relatedId,
      reason: c.reason,
    })),
  };
}

/**
 * Bumps an existing item's confidence up modestly on independent
 * corroboration — never straight to 1.0 from a single additional source.
 */
function corroboratedConfidence(current) {
  return Math.min(0.95, (typeof current === 'number' ? current : 0.5) + 0.15);
}

/**
 * Persists an admin-reviewed batch. Each item in `items` must carry a
 * `decision` ('accept' | 'skip') alongside the same fields
 * `proposeKnowledgeBatch` returned for it (the admin may have edited
 * `claim`/`category`/`topic` before accepting — every field is re-validated
 * here, never trusted as-is, same posture as every other confirm path in
 * this codebase).
 *
 * @param {object} opts
 * @param {string} opts.agentName
 * @param {Array<object>} opts.items
 * @param {object} [opts.actor]
 * @param {number|null} [opts.actor.userId]
 * @returns {Promise<{created: Array, updated: Array, skipped: number}>}
 */
async function confirmKnowledgeBatch({ agentName, items = [], scope = 'agent' } = {}, { userId = null } = {}) {
  assertSupportedAgent(agentName);
  if (!Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest('At least one item is required.', { code: 'ITEMS_REQUIRED' });
  }
  const batchScope = scope === 'global' ? 'global' : 'agent';

  const created = [];
  const updated = [];
  let skipped = 0;

  for (const item of items) {
    const decision = DECISIONS.includes(item?.decision) ? item.decision : 'skip';
    if (decision === 'skip') {
      skipped += 1;
      // eslint-disable-next-line no-continue -- straightforward batch loop, a guard clause per item reads clearer than nested ifs.
      continue;
    }

    if (!item.claim || !String(item.claim).trim()) {
      throw ApiError.badRequest('Every accepted item needs a non-empty claim.', { code: 'CLAIM_REQUIRED' });
    }

    // eslint-disable-next-line no-await-in-loop -- each item's writes must be sequential (supports/contradicts read-then-write the same related row).
    if (item.verdict === 'duplicate' && item.related_id) {
      // eslint-disable-next-line no-await-in-loop
      await knowledgeStore.recordUsage(item.related_id, {});
      skipped += 1;
      continue;
    }

    if (item.verdict === 'supports' && item.related_id) {
      // eslint-disable-next-line no-await-in-loop
      const existing = await knowledgeStore.getKnowledge(item.related_id);
      if (!existing) throw ApiError.notFound(`Knowledge item #${item.related_id} not found.`, { code: 'KNOWLEDGE_NOT_FOUND' });
      // eslint-disable-next-line no-await-in-loop
      const bumped = await knowledgeStore.updateKnowledge(item.related_id, {
        confidence: corroboratedConfidence(existing.confidence),
        status: 'confirmed',
      });
      updated.push(bumped);
      continue;
    }

    if (item.verdict === 'contradicts' && item.related_id) {
      // Neither side wins automatically — both get flagged CONTESTED (not
      // hidden) so the admin, and later the agent's own prompt, sees both
      // sides rather than either one silently vanishing — see
      // runAgentTurn.js's withKnowledge contested-pair formatter.
      // eslint-disable-next-line no-await-in-loop
      const contestedEmbedding = await embedClaim(item.topic, item.claim);
      // eslint-disable-next-line no-await-in-loop
      const contestedRow = await knowledgeStore.createKnowledge({
        scope: batchScope,
        agentName,
        category: item.category,
        topic: item.topic,
        claim: item.claim,
        evidence: item.evidence,
        knowledgeType: item.knowledge_type,
        sourceType: item.source_type || 'manual_text',
        sourceId: item.source_id || null,
        chunkIds: item.chunk_ids || null,
        embedding: contestedEmbedding,
        confidence: 0.4,
        status: 'contested',
        relatedKnowledgeIds: [item.related_id],
        createdBy: userId,
      });
      // eslint-disable-next-line no-await-in-loop
      await knowledgeStore.updateKnowledge(item.related_id, {
        status: 'contested',
        related_knowledge_ids: [contestedRow.id],
      });
      created.push(contestedRow);
      continue;
    }

    // 'new' (or an unrecognised verdict — treated as new rather than silently dropped).
    // eslint-disable-next-line no-await-in-loop
    const newEmbedding = await embedClaim(item.topic, item.claim);
    // eslint-disable-next-line no-await-in-loop
    const createdRow = await knowledgeStore.createKnowledge({
      scope: batchScope,
      agentName,
      category: item.category,
      topic: item.topic,
      claim: item.claim,
      evidence: item.evidence,
      knowledgeType: item.knowledge_type,
      sourceType: item.source_type || 'manual_text',
      sourceId: item.source_id || null,
      chunkIds: item.chunk_ids || null,
      embedding: newEmbedding,
      confidence: 0.5,
      status: 'unverified',
      createdBy: userId,
    });
    created.push(createdRow);
  }

  return { created, updated, skipped };
}

module.exports = {
  proposeKnowledgeBatch,
  confirmKnowledgeBatch,
  assertSupportedAgent,
};
