'use strict';

/**
 * Deterministic char-window chunking (Knowledge Layer v2) — turns a
 * persisted KnowledgeSource's full text into SourceChunk-sized windows, so a
 * long source can be extracted-from in bounded-size batches instead of
 * being hard-truncated (v1's behavior: concatenate everything, clamp to
 * 24,000 chars, silently discard the rest).
 *
 * Deliberately NOT LLM-driven — a fixed-size sliding window with a small
 * overlap is free, predictable, and good enough to (a) bound each
 * extraction call's input size and (b) give a distilled claim something
 * concrete to point back at as evidence. Overlap exists so a fact stated
 * right at a chunk boundary doesn't get split in a way that loses context.
 */

const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 150;

/**
 * @param {string} text
 * @returns {Array<{text: string, charCount: number}>} Empty for blank input;
 *   a single chunk (the whole text) if it already fits within CHUNK_SIZE.
 */
function chunkText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  if (trimmed.length <= CHUNK_SIZE) return [{ text: trimmed, charCount: trimmed.length }];

  const chunks = [];
  let start = 0;

  while (start < trimmed.length) {
    const rawEnd = Math.min(start + CHUNK_SIZE, trimmed.length);
    // Extend to the next word boundary rather than cutting mid-word, unless
    // that would push the chunk unreasonably far past its target size.
    let end = rawEnd;
    if (rawEnd < trimmed.length) {
      const nextSpace = trimmed.indexOf(' ', rawEnd);
      if (nextSpace !== -1 && nextSpace - rawEnd < 100) end = nextSpace;
    }

    const piece = trimmed.slice(start, end).trim();
    if (piece) chunks.push({ text: piece, charCount: piece.length });

    if (end >= trimmed.length) break;
    // Guaranteed forward progress even if overlap math would otherwise stall.
    start = Math.max(start + 1, end - CHUNK_OVERLAP);
  }

  return chunks;
}

module.exports = { chunkText, CHUNK_SIZE, CHUNK_OVERLAP };
