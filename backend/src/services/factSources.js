'use strict';

/**
 * P6-B: CRUD over the org's configured fact sources
 * (`ScripturaSettings` key `content.fact_sources` — one JSON array,
 * org-scoped only; see `constants.FACT_SOURCES_SETTINGS_KEY`'s own comment
 * for why there's no per-user override, same posture as P6-A's image
 * defaults). No new table: the existing KV store already holds arrays fine,
 * and a handful of admin-managed rows never needs its own migration.
 *
 * ---------------------------------------------------------------------------
 * REUSE, NOT A SECOND SCRAPER
 * ---------------------------------------------------------------------------
 * Website and `.txt`/`.docx` document sources are fetched/extracted ONCE, at
 * add time, through `services/brandVoice.js`'s existing, already-hardened
 * `extractFromUrl`/`extractFromFile` — the same SSRF guard, redirect
 * validation, and 2MB/timeout bounds every brand-voice scrape already gets.
 * This file never makes an HTTP request or parses a document itself.
 *
 * ---------------------------------------------------------------------------
 * PDF — HONEST, NOT FABRICATED
 * ---------------------------------------------------------------------------
 * No PDF text-extraction library exists anywhere in this codebase (verified
 * before writing this file), and adding one is a real new-dependency
 * decision this phase does not make unilaterally. A `.pdf` upload is still
 * stored (via the existing `services/storage.js`) and fully manageable —
 * named, tagged, prioritized, toggled, removed — exactly like any other
 * source, but its `contentStatus` is honestly `'unavailable'`. See
 * `services/factVerification.js`: a source in that state is never handed to
 * the verification step as "known content" to check claims against.
 */

const crypto = require('crypto');
const path = require('path');

const ApiError = require('../utils/ApiError');
const {
  FACT_SOURCES_SETTINGS_KEY,
  FACT_VERIFICATION_POLICY_SETTINGS_KEY,
  FACT_VERIFICATION_POLICY_DEFAULT,
  FACT_VERIFICATION_POLICIES,
  FACT_SOURCE_TYPES,
  FACT_SOURCE_PRIORITIES,
  FACT_SOURCE_MAX_EXCERPT_CHARS,
  SETTINGS_SCOPE,
} = require('../constants');

/** @returns {Promise<{sources: object[], policy: string}>} */
async function listFactSources() {
  const { ScripturaSettings } = require('../models');
  const [sources, policy] = await Promise.all([
    ScripturaSettings.getValue(FACT_SOURCES_SETTINGS_KEY, { fallback: [] }),
    ScripturaSettings.getValue(FACT_VERIFICATION_POLICY_SETTINGS_KEY, { fallback: FACT_VERIFICATION_POLICY_DEFAULT }),
  ]);
  return { sources: Array.isArray(sources) ? sources : [], policy: policy || FACT_VERIFICATION_POLICY_DEFAULT };
}

async function saveSources(sources) {
  const { ScripturaSettings } = require('../models');
  await ScripturaSettings.setValue(FACT_SOURCES_SETTINGS_KEY, sources, { scope: SETTINGS_SCOPE.ORG, userId: null });
}

async function setPolicy(policy) {
  if (!Object.values(FACT_VERIFICATION_POLICIES).includes(policy)) {
    throw ApiError.badRequest(`policy must be one of ${Object.values(FACT_VERIFICATION_POLICIES).join(', ')}.`, {
      code: 'FACT_VERIFICATION_POLICY_INVALID',
    });
  }
  const { ScripturaSettings } = require('../models');
  await ScripturaSettings.setValue(FACT_VERIFICATION_POLICY_SETTINGS_KEY, policy, { scope: SETTINGS_SCOPE.ORG, userId: null });
  return policy;
}

/**
 * Resolves a NEW source's stored content + honest `contentStatus`, per its
 * type. Only called once, at add time — editing a source later never
 * re-fetches (see `updateFactSource`).
 */
async function resolveSourceContent({ sourceType, url, referenceText, file }) {
  if (sourceType === FACT_SOURCE_TYPES.REFERENCE_TEXT) {
    const text = String(referenceText || '').trim();
    if (!text) {
      throw ApiError.badRequest('referenceText is required for a reference_text source.', { code: 'REFERENCE_TEXT_REQUIRED' });
    }
    return {
      extractedText: text.slice(0, FACT_SOURCE_MAX_EXCERPT_CHARS),
      contentStatus: 'user_provided',
      url: null,
      fileName: null,
      filePath: null,
    };
  }

  if (sourceType === FACT_SOURCE_TYPES.WEBSITE) {
    if (!url || !String(url).trim()) {
      throw ApiError.badRequest('url is required for a website source.', { code: 'URL_REQUIRED' });
    }
    const { extractFromUrl } = require('./brandVoice');
    const { sample } = await extractFromUrl(String(url).trim());
    return {
      extractedText: sample ? String(sample).slice(0, FACT_SOURCE_MAX_EXCERPT_CHARS) : null,
      contentStatus: sample ? 'full' : 'unavailable',
      url: String(url).trim(),
      fileName: null,
      filePath: null,
    };
  }

  if (sourceType === FACT_SOURCE_TYPES.DOCUMENT || sourceType === FACT_SOURCE_TYPES.PDF) {
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      throw ApiError.badRequest('A file upload is required for this source type.', { code: 'FACT_SOURCE_FILE_REQUIRED' });
    }
    const extension = path.extname(file.originalname || '').toLowerCase();

    // Stored either way — priority/name/toggle apply even when the content
    // can't be read (see this file's header comment). `saveImage` is
    // content-agnostic despite its name — it just builds a convention path
    // and writes bytes via the storage driver; see services/storage.js.
    const { saveImage } = require('./storage');
    const stored = await saveImage(file.buffer, {
      ext: extension.replace('.', '') || 'bin',
      contentType: file.mimetype,
    });

    if (extension === '.pdf') {
      return { extractedText: null, contentStatus: 'unavailable', url: null, fileName: file.originalname, filePath: stored.relativePath };
    }

    const { extractFromFile } = require('./brandVoice');
    try {
      const text = await extractFromFile(file.buffer, file.originalname);
      return {
        extractedText: text ? String(text).slice(0, FACT_SOURCE_MAX_EXCERPT_CHARS) : null,
        contentStatus: text ? 'full' : 'unavailable',
        url: null,
        fileName: file.originalname,
        filePath: stored.relativePath,
      };
    } catch (err) {
      // extractFromFile already validated the extension is one it supports;
      // a thrown error here means the specific file was unreadable (e.g. a
      // corrupt .docx) — the file is still stored above, just unread.
      return { extractedText: null, contentStatus: 'unavailable', url: null, fileName: file.originalname, filePath: stored.relativePath };
    }
  }

  throw ApiError.badRequest(`sourceType must be one of ${Object.values(FACT_SOURCE_TYPES).join(', ')}.`, {
    code: 'FACT_SOURCE_TYPE_INVALID',
  });
}

/**
 * @param {object} input
 * @returns {Promise<object>} The newly created source.
 */
async function addFactSource({ name, sourceType, url, referenceText, file, tags = [], priority = FACT_SOURCE_PRIORITIES.SECONDARY, active = true }) {
  if (!name || !String(name).trim()) {
    throw ApiError.badRequest('name is required.', { code: 'FACT_SOURCE_NAME_REQUIRED' });
  }

  const content = await resolveSourceContent({ sourceType, url, referenceText, file });

  const { sources } = await listFactSources();
  const newSource = {
    id: crypto.randomUUID(),
    name: String(name).trim().slice(0, 150),
    sourceType,
    ...content,
    tags: Array.isArray(tags) ? tags.slice(0, 10).map((t) => String(t).trim().slice(0, 40)).filter(Boolean) : [],
    priority: Object.values(FACT_SOURCE_PRIORITIES).includes(priority) ? priority : FACT_SOURCE_PRIORITIES.SECONDARY,
    active: active !== false,
    createdAt: new Date().toISOString(),
  };

  await saveSources([...sources, newSource]);
  return newSource;
}

/** Metadata-only edit — never re-fetches/re-extracts content. */
async function updateFactSource(id, patch = {}) {
  const { sources } = await listFactSources();
  const index = sources.findIndex((s) => s.id === id);
  if (index === -1) throw ApiError.notFound(`Fact source "${id}" not found.`, { code: 'FACT_SOURCE_NOT_FOUND' });

  const next = { ...sources[index] };
  if ('name' in patch) next.name = String(patch.name || '').trim().slice(0, 150) || sources[index].name;
  if ('tags' in patch) {
    next.tags = Array.isArray(patch.tags) ? patch.tags.slice(0, 10).map((t) => String(t).trim().slice(0, 40)).filter(Boolean) : sources[index].tags;
  }
  if ('priority' in patch && Object.values(FACT_SOURCE_PRIORITIES).includes(patch.priority)) next.priority = patch.priority;
  if ('active' in patch) next.active = patch.active !== false;

  const updated = [...sources];
  updated[index] = next;
  await saveSources(updated);
  return next;
}

async function removeFactSource(id) {
  const { sources } = await listFactSources();
  if (!sources.some((s) => s.id === id)) {
    throw ApiError.notFound(`Fact source "${id}" not found.`, { code: 'FACT_SOURCE_NOT_FOUND' });
  }
  await saveSources(sources.filter((s) => s.id !== id));
}

module.exports = {
  listFactSources,
  addFactSource,
  updateFactSource,
  removeFactSource,
  setPolicy,
  resolveSourceContent,
};
