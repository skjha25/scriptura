'use strict';

/**
 * Storage + hybrid retrieval layer for the shared Knowledge & Learning Layer
 * (see /home/shivam/.claude/plans/zazzy-doodling-wadler.md, "Knowledge Layer
 * v2", for the full architecture this implements).
 *
 * Retrieval is HYBRID (lexical + semantic), computed over one
 * scope-and-status-filtered candidate pool fetched with plain Sequelize —
 * deliberately NOT two separate dialect-branched code paths (MySQL raw-SQL
 * FULLTEXT vs. SQLite LIKE) the way v1 worked. That split was exactly what
 * caused a real production bug earlier: a status-list fix landed in the
 * generic path but not the duplicated raw-SQL string, silently breaking
 * duplicate detection until it was caught by chance. Unifying into one path
 * that both dialects share removes that entire class of drift bug, not just
 * this instance of it.
 *
 * Semantic scoring uses knowledgeEmbedding.js's OpenAI-embeddings +
 * in-process cosine similarity — see that file for why no vector database is
 * used. Lexical scoring is a normalized term-overlap ratio computed in the
 * same pass, not MySQL FULLTEXT — see the same reasoning above; at the
 * candidate-pool-cap scale (500 rows) this is fast and dialect-portable.
 */

const ApiError = require('../../../utils/ApiError');
const { embedText, cosineSimilarity } = require('./knowledgeEmbedding');

// 'contested' added in Knowledge Layer v2 (replaces the old hide-both-sides
// 'contradicted' behavior — see knowledgeBase.js's contradicts branch).
// 'unverified' stays included: excluding it would mean a first round of
// teaching is saved but invisible everywhere (Current Knowledge, the live
// prompt-injection in runAgentTurn.js, get_current_knowledge) — the prompt
// stamp already shows confidence+status per item, so the model still sees an
// unverified claim as less certain than a confirmed/supported one; it's
// surfaced honestly, not silently promoted to fact.
// 'contradicted'/'outdated' stay excluded — explicitly flagged unreliable/superseded.
const RETRIEVABLE_STATUSES = ['unverified', 'confirmed', 'supported', 'contested'];
const DEFAULT_RETRIEVE_LIMIT = 12;
const MAX_RETRIEVE_LIMIT = 30;

// Safety cap on the pool scored per query — bounds retrieval to O(pool) work
// regardless of how large the knowledge base grows. See knowledgeEmbedding.js
// for the honest ceiling on when brute-force scoring like this stops being
// the right approach (tens of thousands of rows per scope; not built for
// that yet because nothing here needs it yet).
const CANDIDATE_POOL_CAP = 500;

// Scoring weights — semantic weighted highest because it's what closes the
// actual failure mode found in production (a conceptually-related query with
// near-zero lexical overlap missing a highly relevant claim); lexical kept
// meaningful because exact/near-exact phrasing should still win outright;
// confidence and freshness are small tie-breakers, not dominant signals.
// Deliberately simple — a fixed weighted sum, not a learned/tuned model —
// per the explicit "don't over-engineer prematurely" instruction. Isolated
// in its own named function so the formula can be replaced without touching
// any caller.
const SCORE_WEIGHTS = Object.freeze({ semantic: 0.5, lexical: 0.3, confidence: 0.15, freshness: 0.05 });
const FRESHNESS_HALF_LIFE_DAYS = 180;

/** Lowercase, strip punctuation, split on whitespace, dedupe. */
function termSet(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean)
  );
}

/** Jaccard overlap between two term sets — 0 if either is empty. */
function lexicalOverlap(queryTerms, candidateTerms) {
  if (queryTerms.size === 0 || candidateTerms.size === 0) return 0;
  let intersection = 0;
  for (const term of queryTerms) {
    if (candidateTerms.has(term)) intersection += 1;
  }
  const union = queryTerms.size + candidateTerms.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** 1.0 for something verified today, decaying toward 0 as last_verified_at ages. */
function freshnessDecay(lastVerifiedAt) {
  if (!lastVerifiedAt) return 0.5; // neutral, not penalized, for rows with no verification timestamp
  const ageDays = (Date.now() - new Date(lastVerifiedAt).getTime()) / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, Math.max(0, ageDays) / FRESHNESS_HALF_LIFE_DAYS);
}

/**
 * Scores one candidate row against a query. Exported and named specifically
 * so this formula is swappable later without touching retrieveKnowledge's
 * control flow.
 * @returns {{score: number, semantic: number, lexical: number}}
 */
function scoreKnowledgeCandidate(row, { queryTerms, queryEmbedding }) {
  const semantic = queryEmbedding ? Math.max(0, cosineSimilarity(row.embedding, queryEmbedding)) : 0;
  const lexical = lexicalOverlap(queryTerms, termSet(`${row.topic} ${row.category} ${row.claim}`));
  const confidence = typeof row.confidence === 'number' ? row.confidence : 0.5;
  const freshness = freshnessDecay(row.last_verified_at);

  const score =
    SCORE_WEIGHTS.semantic * semantic +
    SCORE_WEIGHTS.lexical * lexical +
    SCORE_WEIGHTS.confidence * confidence +
    SCORE_WEIGHTS.freshness * freshness;

  return { score, semantic, lexical };
}

/**
 * @param {string} agentName One of AGENT_NAMES.* — the requesting agent.
 * @param {object} [queryContext]
 * @param {string} [queryContext.text] Free-text task description to rank/filter by.
 * @param {number} [queryContext.limit] Defaults to 12, capped at 30.
 * @param {object} [options]
 * @param {object} [options.embeddingClient] Injected OpenAI client, for tests.
 * @param {boolean} [options.includeSource] FIX 10 (source-ingestion audit) —
 *   joins each row's KnowledgeSource (type/url/content_status/content_method/
 *   metadata, never the full `content` — that's LONGTEXT and this can return
 *   up to CANDIDATE_POOL_CAP rows) so an admin can see exactly what was, and
 *   wasn't, actually read for any knowledge item. Only the admin listing
 *   (controllers/agents.controller.js's getKnowledgeBase) sets this — the
 *   live per-turn prompt-injection call (runAgentTurn.js) has no use for it.
 * @returns {Promise<Array<object>>} AgentKnowledge rows (real model instances), ranked.
 *   Each row also carries non-persisted `relevanceScore`/`retrievalMethod` properties
 *   when a text query was given, for callers that need to log why a row was retrieved
 *   (see runAgentTurn.js's recordKnowledgeUsage).
 */
async function retrieveKnowledge(agentName, { text = '', limit = DEFAULT_RETRIEVE_LIMIT } = {}, options = {}) {
  const { AgentKnowledge, KnowledgeSource } = require('../../../models');
  const { Op } = require('sequelize');

  const boundedLimit = Math.min(Math.max(1, Number(limit) || DEFAULT_RETRIEVE_LIMIT), MAX_RETRIEVE_LIMIT);
  const textFilter = String(text || '').trim();

  const pool = await AgentKnowledge.findAll({
    where: {
      [Op.and]: [
        { [Op.or]: [{ scope: 'global' }, { scope: 'agent', agent_name: agentName }] },
        { status: { [Op.in]: RETRIEVABLE_STATUSES } },
      ],
    },
    order: [
      ['confidence', 'DESC'],
      ['usage_count', 'DESC'],
    ],
    limit: CANDIDATE_POOL_CAP,
    ...(options.includeSource
      ? {
          include: [
            {
              model: KnowledgeSource,
              as: 'source',
              attributes: ['id', 'source_type', 'source_url', 'title', 'author', 'content_status', 'content_method', 'metadata'],
              required: false,
            },
          ],
        }
      : {}),
  });

  if (pool.length === 0) return [];

  // No query text (e.g. get_current_knowledge's "show me everything" call) —
  // nothing to score against, just the confidence/usage ordering already applied.
  if (!textFilter) return pool.slice(0, boundedLimit);

  const queryTerms = termSet(textFilter);
  const queryEmbedding = await embedText(textFilter, { client: options.embeddingClient });
  const retrievalMethod = queryEmbedding ? 'hybrid' : 'lexical';

  const scored = pool.map((row) => {
    const { score, semantic, lexical } = scoreKnowledgeCandidate(row, { queryTerms, queryEmbedding });
    row.relevanceScore = score;
    row.retrievalMethod = semantic > 0 ? 'hybrid' : 'lexical';
    return { row, score, lexical };
  });

  // A candidate with zero lexical AND zero semantic overlap is noise, not a
  // low-ranked match — drop it rather than padding results with confidence-only filler.
  const relevant = scored.filter(({ score, lexical }) => score > 0 || lexical > 0);

  relevant.sort((a, b) => b.score - a.score);

  return relevant.slice(0, boundedLimit).map(({ row }) => row);
}

/** Plain read by id — null if not found, never throws. */
async function getKnowledge(id) {
  const { AgentKnowledge } = require('../../../models');
  return AgentKnowledge.findByPk(id);
}

/**
 * The sole insert path. Defensively shapes/defaults every field — never
 * trusts the caller, same posture as styleProfile.js's confirmStyleProfile.
 * @param {object} data
 * @returns {Promise<object>} The created row.
 */
async function createKnowledge(data = {}) {
  const { AgentKnowledge } = require('../../../models');

  if (!data.scope || !['global', 'agent'].includes(data.scope)) {
    throw ApiError.badRequest('scope must be "global" or "agent".', { code: 'SCOPE_REQUIRED' });
  }
  if (data.scope === 'agent' && !data.agentName) {
    throw ApiError.badRequest('agentName is required when scope is "agent".', { code: 'AGENT_NAME_REQUIRED' });
  }
  if (!data.category || !String(data.category).trim()) {
    throw ApiError.badRequest('category is required.', { code: 'CATEGORY_REQUIRED' });
  }
  if (!data.claim || !String(data.claim).trim()) {
    throw ApiError.badRequest('claim is required.', { code: 'CLAIM_REQUIRED' });
  }

  return AgentKnowledge.create({
    scope: data.scope,
    agent_name: data.scope === 'global' ? null : data.agentName,
    category: String(data.category).trim().slice(0, 100),
    topic: String(data.topic || data.category).trim().slice(0, 255),
    claim: String(data.claim).trim(),
    evidence: data.evidence ? String(data.evidence).trim() : null,
    knowledge_type: data.knowledgeType || 'fact',
    source_type: data.sourceType || 'manual_text',
    source_url: data.sourceUrl ? String(data.sourceUrl).slice(0, 2000) : null,
    source_ref: data.sourceRef ? String(data.sourceRef).slice(0, 255) : null,
    source_id: data.sourceId || null,
    chunk_ids: Array.isArray(data.chunkIds) ? data.chunkIds : null,
    embedding: Array.isArray(data.embedding) ? data.embedding : null,
    confidence: typeof data.confidence === 'number' ? Math.min(1, Math.max(0, data.confidence)) : 0.5,
    status: data.status || 'unverified',
    applicable_context: data.applicableContext || null,
    related_knowledge_ids: Array.isArray(data.relatedKnowledgeIds) ? data.relatedKnowledgeIds : null,
    created_by: data.createdBy || null,
    last_verified_at: new Date(),
  });
}

/**
 * The sole update path for an existing row (confidence changes, status
 * transitions, superseding). Always refreshes `last_verified_at`.
 * @param {number} id
 * @param {object} patch
 * @returns {Promise<object>} The updated row.
 */
async function updateKnowledge(id, patch = {}) {
  const { AgentKnowledge } = require('../../../models');
  const row = await AgentKnowledge.findByPk(id);
  if (!row) throw ApiError.notFound(`Knowledge item #${id} not found.`, { code: 'KNOWLEDGE_NOT_FOUND' });

  const allowed = [
    'claim',
    'evidence',
    'confidence',
    'status',
    'knowledge_type',
    'embedding',
    'source_id',
    'chunk_ids',
    'applicable_context',
    'related_knowledge_ids',
    'version',
    'supersedes_id',
  ];
  const next = {};
  for (const key of allowed) {
    if (key in patch) next[key] = patch[key];
  }
  if (typeof next.confidence === 'number') next.confidence = Math.min(1, Math.max(0, next.confidence));
  next.last_verified_at = new Date();

  await row.update(next);
  return row;
}

/** Marks a knowledge item outdated without deleting it — history stays intact. */
async function invalidateKnowledge(id) {
  return updateKnowledge(id, { status: 'outdated' });
}

/**
 * Bumps usage/success/failure counters — called whenever retrieved knowledge
 * actually informed a decision (usage) and, where a later outcome is known,
 * whether it held up (success) or not (failure).
 */
async function recordUsage(id, { success = null } = {}) {
  const { AgentKnowledge } = require('../../../models');
  const { literal } = require('sequelize');
  const row = await AgentKnowledge.findByPk(id);
  if (!row) return null;

  const increments = { usage_count: literal('usage_count + 1') };
  if (success === true) increments.success_count = literal('success_count + 1');
  if (success === false) increments.failure_count = literal('failure_count + 1');

  await row.update(increments);
  return row;
}

/**
 * P5-A/B: applies bounded, deterministic reinforcement from ONE qualifying
 * outcome to ONE knowledge row — increments `success_count` XOR
 * `failure_count`, and once `minSamples` qualifying observations have
 * accumulated, nudges `confidence` by a small, symmetric, capped delta.
 *
 * Deliberately separate from `recordUsage` (bumps `usage_count` — a
 * *retrieval*-time signal, already recorded once when this row was fetched
 * into a chat turn's context; reinforcement is a *later validation* of that
 * same use, not a new use, so `usage_count` must NOT move here) and from
 * `updateKnowledge` (a human-edit path that always refreshes
 * `last_verified_at` — reinforcement must never touch that field, or
 * `status`, `scope`, `agent_name`, `claim`, or any other column). This
 * function writes ONLY `success_count`/`failure_count`/`confidence` — the
 * exact field set P5 is scoped to.
 *
 * All policy (threshold, delta magnitude, bounds) is passed in explicitly by
 * the caller (services/agents/knowledge/knowledgeReinforcement.js) rather
 * than defaulted here, so the numbers are documented and testable in
 * exactly one place.
 *
 * @param {number} id
 * @param {object} policy
 * @param {boolean} policy.success true = this row's evidence was validated (outcome improved), false = contradicted (outcome declined).
 * @param {number} policy.minSamples Total qualifying (success+failure) observations required before confidence moves at all.
 * @param {number} policy.positiveDelta Added to confidence on a success, once minSamples is reached.
 * @param {number} policy.negativeDelta Subtracted from confidence on a failure, once minSamples is reached.
 * @param {number} policy.minConfidence Hard floor.
 * @param {number} policy.maxConfidence Hard ceiling.
 * @returns {Promise<object|null>} The updated row, or null if it no longer exists.
 */
async function reinforceKnowledge(id, { success, minSamples, positiveDelta, negativeDelta, minConfidence, maxConfidence }) {
  const { AgentKnowledge } = require('../../../models');
  const row = await AgentKnowledge.findByPk(id);
  if (!row) return null;

  const nextSuccessCount = row.success_count + (success ? 1 : 0);
  const nextFailureCount = row.failure_count + (success ? 0 : 1);
  const totalQualifying = nextSuccessCount + nextFailureCount;

  const patch = success ? { success_count: nextSuccessCount } : { failure_count: nextFailureCount };

  if (totalQualifying >= minSamples) {
    const delta = success ? positiveDelta : -negativeDelta;
    const current = typeof row.confidence === 'number' ? row.confidence : 0.5;
    patch.confidence = Math.min(maxConfidence, Math.max(minConfidence, current + delta));
  }

  await row.update(patch);
  return row;
}

module.exports = {
  retrieveKnowledge,
  getKnowledge,
  createKnowledge,
  updateKnowledge,
  invalidateKnowledge,
  recordUsage,
  reinforceKnowledge,
  scoreKnowledgeCandidate,
  RETRIEVABLE_STATUSES,
  DEFAULT_RETRIEVE_LIMIT,
  CANDIDATE_POOL_CAP,
};
