'use strict';

/**
 * Source-gathering for the Knowledge & Learning Layer (v2) — persists every
 * source fully, then chunks it, instead of v1's "concatenate everything,
 * hard-truncate at 24,000 chars, discard the rest, never store the raw
 * source." See /home/shivam/.claude/plans/zazzy-doodling-wadler.md.
 *
 * `gatherContent` now returns one entry per successfully-ingested source
 * (each already persisted as a KnowledgeSource + its SourceChunks), for
 * knowledgeExtraction.js to extract from — either as one call (short
 * sources) or per chunk-group (long ones). A failed source only appears in
 * `sourcesMeta` with an `.error`, never in `sources` — one bad link or a
 * caption-less YouTube video must not block the rest of the same submission.
 *
 * Link fetching reuses services/brandVoice.js's `extractFromUrl` directly —
 * that function's SSRF guard (DNS-resolved, redirect-re-checked, private/
 * loopback/link-local ranges blocked) is already implemented and unit-tested
 * there; re-implementing it here would be an unwarranted second copy of a
 * security-critical control.
 *
 * Video/YouTube honestly: this is TRANSCRIPT-based (spoken-word) understanding
 * only, never visual/frame-level. YouTube caption scraping parses an
 * undocumented page structure and can break without notice — it always falls
 * back to YouTube's official oEmbed endpoint (title/author only) rather than
 * hard-failing. Video transcription reuses the already-installed `openai`
 * SDK's Whisper endpoint directly on the uploaded buffer (mp4/webm/mov all
 * accepted natively — no separate ffmpeg audio-extraction step needed).
 */

const crypto = require('crypto');
const axios = require('axios');
const sharp = require('sharp');

const ApiError = require('../../../utils/ApiError');
const logger = require('../../../utils/logger');
const config = require('../../../config');
const prompts = require('../../ai/prompts');
const brandVoice = require('../../brandVoice');
const storage = require('../../storage');
const { toPlainText } = require('../../sanitize');
const { chunkText } = require('./knowledgeSourceChunking');

// A generous abuse-prevention ceiling on what gets PERSISTED per source —
// NOT a practical-content truncation limit the way v1's 12k/24k were. ~200KB
// comfortably covers even a 2-hour video transcript; this only guards
// against a single pathological paste ballooning the DB unbounded.
const MAX_SOURCE_CHARS = 200000;

const MAX_TEXT_SAMPLES = 20;
const MAX_LINKS = 10;
const MAX_IMAGES = 5;
const MAX_YOUTUBE_LINKS = 5;

const YOUTUBE_FETCH_TIMEOUT_MS = 8000;
const YOUTUBE_USER_AGENT = 'Mozilla/5.0 (compatible; ScripturaKnowledgeBase/1.0)';
const YOUTUBE_ID_RE = /(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/;

/** Whisper's own hard file-size ceiling — enforced before any network call. */
const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

const IMAGE_MEDIA_TYPES = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

/** @returns {Promise<{text: string, method: 'captions'}>} */
async function scrapeYoutubeCaptions(url) {
  const match = YOUTUBE_ID_RE.exec(String(url || ''));
  if (!match) throw new Error('Not a recognisable YouTube URL.');
  const videoId = match[1];

  const page = await axios.get(`https://www.youtube.com/watch?v=${videoId}`, {
    timeout: YOUTUBE_FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': YOUTUBE_USER_AGENT },
    maxContentLength: 5 * 1024 * 1024,
  });

  const html = String(page.data || '');
  const jsonMatch = /"captionTracks":(\[[^\]]*\])/.exec(html);
  if (!jsonMatch) throw new Error('No caption tracks found in page.');

  const tracks = JSON.parse(jsonMatch[1].replace(/\\u0026/g, '&'));
  const track = tracks.find((t) => String(t?.languageCode || '').startsWith('en')) || tracks[0];
  if (!track?.baseUrl) throw new Error('No usable caption track URL.');

  const captionXml = await axios.get(track.baseUrl, { timeout: YOUTUBE_FETCH_TIMEOUT_MS });
  const text = String(captionXml.data || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length < 50) throw new Error('Extracted caption text too short.');
  return { text, method: 'captions' };
}

/** Official, ToS-friendly, no API key — the mandatory fallback when captions aren't available. */
async function fetchYoutubeOEmbed(url) {
  const res = await axios.get('https://www.youtube.com/oembed', {
    params: { url, format: 'json' },
    timeout: YOUTUBE_FETCH_TIMEOUT_MS,
  });
  const { title, author_name: authorName } = res.data || {};
  if (!title) {
    throw ApiError.unprocessable(
      'Could not read anything about that YouTube video (not embeddable, private, or removed).',
      { code: 'YOUTUBE_UNAVAILABLE' }
    );
  }
  return {
    text: `YouTube video: "${title}" by ${authorName || 'unknown author'}. (Captions unavailable — title/author only.)`,
    method: 'oembed',
    title,
    author: authorName || null,
  };
}

/**
 * @param {string} url
 * @returns {Promise<{text: string, method: 'captions'|'oembed', title?: string, author?: string|null}>}
 */
async function extractYoutubeText(url) {
  try {
    return await scrapeYoutubeCaptions(url);
  } catch (err) {
    logger.warn('YouTube caption scrape failed, falling back to oEmbed', { url, message: err.message });
    return fetchYoutubeOEmbed(url);
  }
}

// ---------------------------------------------------------------------------
// Video transcription (Whisper, via the already-installed `openai` SDK)
// ---------------------------------------------------------------------------

/**
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {object} [options]
 * @param {object} [options.client] Pre-built OpenAI SDK client, for tests.
 * @returns {Promise<string>}
 */
async function transcribeVideoBuffer(buffer, mimeType, { client } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw ApiError.badRequest('Empty video buffer.', { code: 'EMPTY_FILE' });
  }
  if (buffer.length > WHISPER_MAX_BYTES) {
    throw ApiError.unprocessable(`Video is too large to transcribe (max ${WHISPER_MAX_BYTES / 1e6}MB).`, {
      code: 'VIDEO_TOO_LARGE',
    });
  }
  if (!config.ai.openai.apiKey && !client) {
    throw ApiError.unprocessable('Video transcription requires OPENAI_API_KEY to be configured.', {
      code: 'TRANSCRIPTION_UNAVAILABLE',
    });
  }

  const OpenAI = require('openai');
  const { toFile } = require('openai');
  const openaiClient = client || new OpenAI({ apiKey: config.ai.openai.apiKey });

  const ext = mimeType?.includes('webm') ? 'webm' : mimeType?.includes('quicktime') ? 'mov' : 'mp4';
  const file = await toFile(buffer, `clip.${ext}`);
  const result = await openaiClient.audio.transcriptions.create({ file, model: 'whisper-1' });
  return result?.text || '';
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/** @returns {Promise<{mediaType: string, base64: string}>} */
async function gatherImage(relativePath) {
  const buffer = await storage.readFile(relativePath);
  const meta = await sharp(buffer).metadata();
  const mediaType = IMAGE_MEDIA_TYPES[meta.format] || 'image/png';
  return { mediaType, base64: buffer.toString('base64') };
}

// ---------------------------------------------------------------------------
// Persistence — full source + chunks, the core of the v2 change.
// ---------------------------------------------------------------------------

/**
 * Persists a text-bearing source in full (no truncation beyond the generous
 * MAX_SOURCE_CHARS abuse-prevention ceiling) and chunks it.
 * @returns {Promise<{sourceId:number, sourceType:string, title:string|null, fullText:string, images:[], chunkRows:Array<{id:number,sequence:number,text:string}>}>}
 */
async function persistTextSource({ sourceType, content, sourceUrl = null, title = null, author = null, createdBy = null }) {
  const { KnowledgeSource, SourceChunk } = require('../../../models');

  const bounded = prompts.clamp(content, MAX_SOURCE_CHARS);
  const contentHash = crypto.createHash('sha256').update(bounded).digest('hex');

  const source = await KnowledgeSource.create({
    source_type: sourceType,
    content: bounded,
    source_url: sourceUrl,
    title,
    author,
    content_hash: contentHash,
    created_by: createdBy,
  });

  const pieces = chunkText(bounded);
  const chunkRows = [];
  for (const piece of pieces) {
    // eslint-disable-next-line no-await-in-loop -- chunk order must be sequential and small in count (bounded by MAX_SOURCE_CHARS/CHUNK_SIZE), a Promise.all here buys nothing.
    const chunk = await SourceChunk.create({
      source_id: source.id,
      sequence: chunkRows.length,
      text: piece.text,
      char_count: piece.charCount,
    });
    chunkRows.push({ id: chunk.id, sequence: chunk.sequence, text: chunk.text });
  }

  return { sourceId: source.id, sourceType, title, fullText: bounded, images: [], chunkRows };
}

// ---------------------------------------------------------------------------
// Combined gather — the single entry point knowledgeBase.js calls.
// ---------------------------------------------------------------------------

/**
 * Every failure is per-source and degrades that one `sourcesMeta` entry with
 * an `.error` field rather than failing the whole batch.
 *
 * @param {object} sources
 * @param {string[]} [sources.textSamples]
 * @param {string[]} [sources.links]
 * @param {string[]} [sources.imagePaths] Already-uploaded relativePaths (via /media/upload).
 * @param {string[]} [sources.youtubeLinks]
 * @param {Buffer|null} [sources.videoBuffer]
 * @param {string|null} [sources.videoMimeType]
 * @param {number|null} [sources.createdBy]
 * @returns {Promise<{sources: Array<object>, sourcesMeta: Array<object>}>}
 */
async function gatherContent({
  textSamples = [],
  links = [],
  imagePaths = [],
  youtubeLinks = [],
  videoBuffer = null,
  videoMimeType = null,
  createdBy = null,
} = {}) {
  const gatheredSources = [];
  const sourcesMeta = [];

  for (const raw of textSamples.slice(0, MAX_TEXT_SAMPLES)) {
    const cleaned = toPlainText(String(raw || '')) || String(raw || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    // eslint-disable-next-line no-await-in-loop -- each source's persist+chunk must complete before the next (sequence numbering, id assignment); this is a small, admin-paced batch, not a hot path.
    const persisted = await persistTextSource({ sourceType: 'manual_text', content: cleaned, createdBy });
    gatheredSources.push(persisted);
    sourcesMeta.push({ type: 'text', chars: cleaned.length, source_id: persisted.sourceId });
  }

  for (const url of links.slice(0, MAX_LINKS)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { sample, finalUrl } = await brandVoice.extractFromUrl(url);
      // eslint-disable-next-line no-await-in-loop
      const persisted = await persistTextSource({ sourceType: 'web_link', content: sample, sourceUrl: finalUrl, createdBy });
      gatheredSources.push(persisted);
      sourcesMeta.push({ type: 'link', url: finalUrl, source_id: persisted.sourceId });
    } catch (err) {
      sourcesMeta.push({ type: 'link', url, error: err.message });
    }
  }

  for (const youtubeUrl of youtubeLinks.slice(0, MAX_YOUTUBE_LINKS)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { text, method, title, author } = await extractYoutubeText(youtubeUrl);
      // eslint-disable-next-line no-await-in-loop
      const persisted = await persistTextSource({
        sourceType: 'youtube',
        content: text,
        sourceUrl: youtubeUrl,
        title: title || null,
        author: author || null,
        createdBy,
      });
      gatheredSources.push(persisted);
      sourcesMeta.push({ type: 'youtube', url: youtubeUrl, method, source_id: persisted.sourceId });
    } catch (err) {
      sourcesMeta.push({ type: 'youtube', url: youtubeUrl, error: err.message });
    }
  }

  if (videoBuffer) {
    try {
      const transcript = await transcribeVideoBuffer(videoBuffer, videoMimeType);
      const persisted = await persistTextSource({ sourceType: 'video', content: transcript, createdBy });
      gatheredSources.push(persisted);
      sourcesMeta.push({ type: 'video', chars: transcript.length, source_id: persisted.sourceId });
    } catch (err) {
      sourcesMeta.push({ type: 'video', error: err.message });
    }
  }

  for (const relativePath of imagePaths.slice(0, MAX_IMAGES)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const image = await gatherImage(relativePath);
      const { KnowledgeSource } = require('../../../models');
      // eslint-disable-next-line no-await-in-loop
      const source = await KnowledgeSource.create({
        source_type: 'image',
        storage_path: relativePath,
        created_by: createdBy,
      });
      gatheredSources.push({
        sourceId: source.id,
        sourceType: 'image',
        title: null,
        fullText: null,
        images: [image],
        chunkRows: [],
      });
      sourcesMeta.push({ type: 'image', path: relativePath, source_id: source.id });
    } catch (err) {
      sourcesMeta.push({ type: 'image', path: relativePath, error: err.message });
    }
  }

  return { sources: gatheredSources, sourcesMeta };
}

module.exports = {
  gatherContent,
  persistTextSource,
  extractYoutubeText,
  transcribeVideoBuffer,
  MAX_TEXT_SAMPLES,
  MAX_LINKS,
  MAX_IMAGES,
  MAX_YOUTUBE_LINKS,
  MAX_SOURCE_CHARS,
  WHISPER_MAX_BYTES,
};
