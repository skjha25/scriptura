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
 * only, never visual/frame-level. Real transcript retrieval goes through
 * youtubeTranscriptProvider.js (a headless-Chromium scrape of YouTube's own
 * "Show transcript" panel — the old direct-`timedtext`-fetch approach this
 * replaced turned out to be broken by YouTube's headless-automation
 * detection, not merely flaky; see that file's docstring for the full
 * investigation). On failure (no captions, or a transient provider error) it
 * falls back to YouTube's official oEmbed endpoint (title/author only), which
 * is tagged `content_status: 'metadata_only'` and is never sent to knowledge
 * extraction (see knowledgeExtraction.js's per-source gate) — title/author
 * text used to get silently treated as if it were the video's actual
 * content, which is the false-knowledge bug the source-ingestion audit
 * flagged. Video transcription (direct upload, not YouTube) reuses the
 * already-installed `openai` SDK's Whisper endpoint directly on the uploaded
 * buffer (mp4/webm/mov all accepted natively — no separate ffmpeg
 * audio-extraction step needed).
 *
 * Every persisted source now carries `content_status` ("how much of the
 * actual content did we access" — full/partial/metadata_only/unavailable/
 * user_provided) and `content_method` (how it was obtained — captions/
 * oembed/html/manual_text/whisper/image_upload), set explicitly by each
 * gathering path below, never inferred later. See models/knowledgeSource.js.
 *
 * `persistTextSource` also does content-hash-based dedup: identical content
 * (by normalized SHA-256, independent of URL) reuses the existing
 * KnowledgeSource + SourceChunks instead of creating duplicates, and the
 * returned `reused: true` flag tells extractFromSources to skip re-extracting
 * from it — a resubmission of the same content must not re-call Claude.
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
const YOUTUBE_ID_RE = /(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/;

/** Whisper's own hard file-size ceiling — enforced before any network call. */
const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

const IMAGE_MEDIA_TYPES = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

/**
 * Official, ToS-friendly, no API key — the fallback when a real transcript
 * genuinely can't be obtained (no captions, or the transcript provider hit a
 * transient error). Title/author ONLY — this is metadata about the video,
 * never a substitute for its actual spoken content. Callers must tag
 * whatever they persist from this as `content_status: 'metadata_only'`, not
 * 'full'.
 * @param {string} url
 * @param {object} [options]
 * @param {Function} [options.request] axios-compatible GET, for tests (test seam).
 */
async function fetchYoutubeOEmbed(url, { request } = {}) {
  const get = request || axios.get;
  const res = await get('https://www.youtube.com/oembed', {
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
    text: `YouTube video: "${title}" by ${authorName || 'unknown author'}. (Transcript unavailable — title/author only, not the video's actual content.)`,
    method: 'oembed',
    title,
    author: authorName || null,
  };
}

/**
 * Orchestrates real-transcript-then-oEmbed fallback and tags the RESULT with
 * an explicit content_status — this is the field knowledgeExtraction.js's
 * per-source gate reads to decide whether a source may reach Claude at all
 * (FIX 3). Throws only when BOTH the transcript provider AND oEmbed fail —
 * that's the genuine "unavailable" case, surfaced as a real error rather
 * than persisted as a fake source.
 *
 * The real transcript attempt goes through youtubeTranscriptProvider.js
 * (a headless-Chromium scrape of YouTube's own "Show transcript" panel —
 * see that file for why the old direct-timedtext-fetch approach this
 * replaced was fundamentally broken, not just flaky). `oEmbed` remains the
 * fallback for: no captions exist, or the provider hit a transient error.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {Function} [options.request] Test seam, forwarded to fetchYoutubeOEmbed.
 * @param {{fetchTranscript: Function}} [options.transcriptProvider] Test seam — defaults to youtubeTranscriptProvider.
 * @returns {Promise<{text: string, method: 'youtube_captions'|'oembed', contentStatus: 'full'|'metadata_only', title?: string|null, author?: string|null, language?: string|null, isAutoGenerated?: boolean}>}
 */
async function extractYoutubeText(url, options = {}) {
  const match = YOUTUBE_ID_RE.exec(String(url || ''));
  if (match) {
    const videoId = match[1];
    const provider = options.transcriptProvider || require('./youtubeTranscriptProvider');
    const result = await provider.fetchTranscript(videoId, options);

    if (result.status === 'ok') {
      return {
        text: result.transcript,
        method: 'youtube_captions',
        contentStatus: 'full',
        title: result.title || null,
        author: result.author || null,
        language: result.language,
        isAutoGenerated: result.isAutoGenerated,
      };
    }
    logger.warn('YouTube transcript retrieval did not yield usable captions, falling back to oEmbed', {
      url,
      videoId,
      status: result.status,
      reason: result.reason,
    });
  }
  const oembed = await fetchYoutubeOEmbed(url, options);
  return { ...oembed, contentStatus: 'metadata_only' };
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
 * MAX_SOURCE_CHARS abuse-prevention ceiling) and chunks it — unless a source
 * with the IDENTICAL normalized content already exists (FIX 8: content-hash
 * dedup), in which case the existing KnowledgeSource + SourceChunks are
 * reused as-is (`reused: true`) rather than creating duplicates. Content
 * identity is the hash alone, deliberately independent of `sourceUrl` — the
 * same content re-published at a different URL is the same source; the same
 * URL with genuinely changed content hashes differently and creates a new
 * row rather than incorrectly reusing stale content (no versioning yet).
 *
 * @param {string} contentStatus SOURCE ACCESS STATE — see models/knowledgeSource.js. Required.
 * @param {string} method PROVENANCE — how this was obtained. Required.
 * @param {object|null} [metadata] e.g. YouTube caption language/auto-generated flag (FIX 5).
 * @returns {Promise<{sourceId:number, sourceType:string, title:string|null, fullText:string, images:[], chunkRows:Array<{id:number,sequence:number,text:string}>, contentStatus:string, method:string, reused:boolean}>}
 */
async function persistTextSource({
  sourceType,
  content,
  sourceUrl = null,
  title = null,
  author = null,
  createdBy = null,
  contentStatus,
  method,
  metadata = null,
}) {
  const { KnowledgeSource, SourceChunk } = require('../../../models');

  const bounded = prompts.clamp(content, MAX_SOURCE_CHARS);
  const contentHash = crypto.createHash('sha256').update(bounded).digest('hex');

  const existing = await KnowledgeSource.findOne({ where: { content_hash: contentHash } });
  if (existing) {
    const existingChunks = await SourceChunk.findAll({ where: { source_id: existing.id }, order: [['sequence', 'ASC']] });
    return {
      sourceId: existing.id,
      sourceType: existing.source_type,
      title: existing.title,
      fullText: existing.content,
      images: [],
      chunkRows: existingChunks.map((c) => ({ id: c.id, sequence: c.sequence, text: c.text })),
      contentStatus: existing.content_status,
      method: existing.content_method,
      reused: true,
    };
  }

  const source = await KnowledgeSource.create({
    source_type: sourceType,
    content: bounded,
    source_url: sourceUrl,
    title,
    author,
    content_hash: contentHash,
    content_status: contentStatus,
    content_method: method,
    metadata,
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

  return { sourceId: source.id, sourceType, title, fullText: bounded, images: [], chunkRows, contentStatus, method, reused: false };
}

// ---------------------------------------------------------------------------
// Web access-gate detection (FIX 6) — "extracted text > 200 characters" was
// previously treated as proof the requested page was actually read. It
// isn't: a login wall, a Cloudflare interstitial, or a generic error page
// all easily clear that bar. Deliberately NOT a LinkedIn-specific scraper —
// this runs against whatever brandVoice.extractFromUrl already returned, for
// every web_link source, and only classifies content_status; the existing
// generic extractor and its SSRF guard (assertSafeUrl) are untouched.
// ---------------------------------------------------------------------------

// Unambiguous on their own — an article's prose is never going to say these.
const ACCESS_GATE_STRONG_PATTERNS = [
  /access denied/i,
  /403 forbidden/i,
  /verify you('| a)re (a )?human/i,
  /are you a robot/i,
  /checking your browser/i,
  /just a moment\.\.\./i,
  /this content is (not|no longer) available/i,
  /enable javascript to continue/i,
];

// Common in ordinary prose, so only trusted as a gate signal when they make
// up a large share of a SHORT extraction — exactly the shape of a login-wall
// page (a few hundred chars of chrome, no article body).
const ACCESS_GATE_WEAK_PATTERNS = [
  /\bsign in\b/i,
  /\blog\s?in\b/i,
  /\bjoin now\b/i,
  /authentication required/i,
  /please log in/i,
  /you must be logged in/i,
  /create (a free )?account to (continue|view|read)/i,
];
const ACCESS_GATE_WEAK_MAX_CHARS = 1000;

/** @returns {boolean} true if the extracted sample looks like a login wall/interstitial, not the requested page's real content. */
function detectAccessGate(sample) {
  const text = String(sample || '');
  if (ACCESS_GATE_STRONG_PATTERNS.some((re) => re.test(text))) return true;
  return text.length <= ACCESS_GATE_WEAK_MAX_CHARS && ACCESS_GATE_WEAK_PATTERNS.some((re) => re.test(text));
}

// ---------------------------------------------------------------------------
// Combined gather — the single entry point knowledgeBase.js calls.
// ---------------------------------------------------------------------------

/**
 * Every failure is per-source and degrades that one `sourcesMeta` entry with
 * an `.error` field rather than failing the whole batch. Every SUCCESSFUL
 * entry now also carries `content_status`/`method` so the UI (FIX 7) and any
 * later inspection (FIX 10) can show exactly what was — and wasn't — read.
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
    const persisted = await persistTextSource({
      sourceType: 'manual_text',
      content: cleaned,
      createdBy,
      contentStatus: 'user_provided',
      method: 'manual_text',
    });
    gatheredSources.push(persisted);
    sourcesMeta.push({
      type: 'text',
      chars: cleaned.length,
      source_id: persisted.sourceId,
      content_status: persisted.contentStatus,
      method: persisted.method,
      reused: persisted.reused,
    });
  }

  for (const url of links.slice(0, MAX_LINKS)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { sample, finalUrl } = await brandVoice.extractFromUrl(url);
      const gated = detectAccessGate(sample);
      // eslint-disable-next-line no-await-in-loop
      const persisted = await persistTextSource({
        sourceType: 'web_link',
        content: sample,
        sourceUrl: finalUrl,
        createdBy,
        contentStatus: gated ? 'metadata_only' : 'full',
        method: 'html',
      });
      gatheredSources.push(persisted);
      sourcesMeta.push({
        type: 'link',
        url: finalUrl,
        source_id: persisted.sourceId,
        content_status: persisted.contentStatus,
        method: persisted.method,
        reused: persisted.reused,
        ...(gated ? { gate_detected: true } : {}),
      });
    } catch (err) {
      sourcesMeta.push({ type: 'link', url, content_status: 'unavailable', error: err.message });
    }
  }

  for (const youtubeUrl of youtubeLinks.slice(0, MAX_YOUTUBE_LINKS)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await extractYoutubeText(youtubeUrl);
      // eslint-disable-next-line no-await-in-loop
      const persisted = await persistTextSource({
        sourceType: 'youtube',
        content: result.text,
        sourceUrl: youtubeUrl,
        title: result.title || null,
        author: result.author || null,
        createdBy,
        contentStatus: result.contentStatus,
        method: result.method,
        metadata:
          result.method === 'youtube_captions'
            ? { language: result.language || null, is_auto_generated: !!result.isAutoGenerated }
            : null,
      });
      gatheredSources.push(persisted);
      sourcesMeta.push({
        type: 'youtube',
        url: youtubeUrl,
        source_id: persisted.sourceId,
        content_status: persisted.contentStatus,
        method: persisted.method,
        reused: persisted.reused,
        ...(result.method === 'youtube_captions'
          ? { language: result.language || null, is_auto_generated: !!result.isAutoGenerated }
          : {}),
      });
    } catch (err) {
      // BOTH the real transcript AND oEmbed failed — a genuine "we accessed
      // nothing" case (FIX 4). Not persisted (nothing real to store),
      // surfaced as a real error instead of silently becoming fake content.
      sourcesMeta.push({ type: 'youtube', url: youtubeUrl, content_status: 'unavailable', error: err.message });
    }
  }

  if (videoBuffer) {
    try {
      const transcript = await transcribeVideoBuffer(videoBuffer, videoMimeType);
      const persisted = await persistTextSource({
        sourceType: 'video',
        content: transcript,
        createdBy,
        contentStatus: 'full',
        method: 'whisper',
      });
      gatheredSources.push(persisted);
      sourcesMeta.push({
        type: 'video',
        chars: transcript.length,
        source_id: persisted.sourceId,
        content_status: persisted.contentStatus,
        method: persisted.method,
        reused: persisted.reused,
      });
    } catch (err) {
      sourcesMeta.push({ type: 'video', content_status: 'unavailable', error: err.message });
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
        content_status: 'full',
        content_method: 'image_upload',
        created_by: createdBy,
      });
      gatheredSources.push({
        sourceId: source.id,
        sourceType: 'image',
        title: null,
        fullText: null,
        images: [image],
        chunkRows: [],
        contentStatus: 'full',
        method: 'image_upload',
        reused: false,
      });
      sourcesMeta.push({ type: 'image', path: relativePath, source_id: source.id, content_status: 'full', method: 'image_upload' });
    } catch (err) {
      sourcesMeta.push({ type: 'image', path: relativePath, content_status: 'unavailable', error: err.message });
    }
  }

  return { sources: gatheredSources, sourcesMeta };
}

module.exports = {
  gatherContent,
  persistTextSource,
  extractYoutubeText,
  fetchYoutubeOEmbed,
  transcribeVideoBuffer,
  detectAccessGate,
  MAX_TEXT_SAMPLES,
  MAX_LINKS,
  MAX_IMAGES,
  MAX_YOUTUBE_LINKS,
  MAX_SOURCE_CHARS,
  WHISPER_MAX_BYTES,
};
