'use strict';

/**
 * Embedding generation + comparison for hybrid retrieval (Knowledge Layer v2).
 *
 * No vector database — MySQL here is 8.0.46 (checked directly; no native
 * VECTOR type, that's 9.0+). Embeddings are generated via the OpenAI SDK
 * that's already installed, already configured (config.ai.openai.apiKey),
 * and already used for Whisper transcription (see knowledgeIngestion.js's
 * transcribeVideoBuffer) — reusing that same client rather than adding a new
 * provider. Vectors are stored as a plain JSON float array
 * (agent_knowledge.embedding / source_chunks.embedding) and compared via
 * cosine similarity computed in application code over the already
 * scope-and-status-filtered candidate set from knowledgeStore.retrieveKnowledge.
 *
 * Explicit ceiling, stated honestly: brute-force in-process cosine
 * similarity is fast at the realistic scale here (low thousands of rows per
 * agent scope) but stops being the right approach somewhere around tens of
 * thousands of rows, where an ANN index/real vector store would earn its
 * complexity. Not built now because nothing here needs it yet.
 */

const config = require('../../../config');
const logger = require('../../../utils/logger');

/**
 * @param {string} text
 * @param {object} [options]
 * @param {object} [options.client] Pre-built OpenAI SDK client, for tests.
 * @returns {Promise<number[]|null>} null on any failure — embedding is
 *   always best-effort, never something a caller should let block a write
 *   or a chat turn (see knowledgeBase.js's embedAndStore and
 *   runAgentTurn.js's retrieveRelevantKnowledge, both already fail-open).
 */
async function embedText(text, { client } = {}) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  if (!config.ai.openai.apiKey && !client) {
    logger.warn('Embedding skipped — OPENAI_API_KEY not configured.');
    return null;
  }

  try {
    const OpenAI = require('openai');
    const openaiClient = client || new OpenAI({ apiKey: config.ai.openai.apiKey });
    const response = await openaiClient.embeddings.create({
      model: config.ai.openai.embeddingModel,
      // Embedding models have their own input-size limits well above this,
      // but capping keeps one pathological input from ballooning cost.
      input: trimmed.slice(0, 8000),
    });
    const vector = response?.data?.[0]?.embedding;
    return Array.isArray(vector) ? vector : null;
  } catch (err) {
    logger.warn('Embedding generation failed — continuing without it', { message: err.message });
    return null;
  }
}

/**
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} 0 if either vector is missing/mismatched-length, else -1..1.
 */
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

module.exports = { embedText, cosineSimilarity };
