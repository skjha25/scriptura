'use strict';

/**
 * Google Search Console integration — Search Analytics only.
 *
 * Mirrors services/serp.js's shape deliberately, so the two optional
 * integrations behave identically from a caller's point of view:
 *   - `gscAuth.isEnabled()` gates everything (flag AND real credentials AND a
 *     site URL); a half-configured deployment behaves like a disabled one.
 *   - The low-level request (`queryGscApi`) never persists. The public
 *     function (`fetchSearchAnalytics`) fetches, normalizes, and calls
 *     `saveGscSnapshot` — same "request separate from persistence, public
 *     function orchestrates both" split as serp.js's request()/checkRank().
 *   - `saveGscSnapshot` is dedup-aware on (site_url, date range, dimensions)
 *     within a short window, exactly like serp.js's saveSerpSnapshot, so a
 *     double-call doesn't create a near-duplicate row but a call next week
 *     always creates real history.
 *
 * The agent NEVER reaches this file — only services/agents/tools/
 * seoAnalystAgentTools.js's get_gsc_performance tool does, and that tool only
 * reads gsc_snapshots/gsc_rows, never calls fetchSearchAnalytics. This file
 * is the only thing in the app that talks to Google.
 */

const { Op } = require('sequelize');

const config = require('../config');
const gscAuth = require('./gscAuth');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { toPlainText } = require('./sanitize');

/** Matches services/serp.js's SNAPSHOT_DEDUP_WINDOW_MS — same "accidental double-call" reasoning. */
const SNAPSHOT_DEDUP_WINDOW_MS = 15 * 60 * 1000;

/** The SEO Analyst's sensible default — enough to answer "what's working" without over-fetching. */
const DEFAULT_DIMENSIONS = Object.freeze(['query', 'page', 'date']);

/** GSC's per-request cap is 25000; this app only ever needs a bounded read, not a full export. */
const DEFAULT_ROW_LIMIT = 1000;

const SEARCH_ANALYTICS_URL = (siteUrl) =>
  `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;

/** `{start, end}` ISO date strings (YYYY-MM-DD) for the trailing 7 days ending yesterday — GSC data lags by a few days, so "today" is never populated yet. */
function lastNDays(n = 7) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2); // GSC's own processing lag; asking for today/yesterday routinely returns nothing.
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (n - 1));
  const iso = (d) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

/**
 * One Search Analytics request. No persistence, no dedup — a raw, validated
 * call, same role as serp.js's private `request()`.
 * @private
 */
async function queryGscApi({ siteUrl, startDate, endDate, dimensions, rowLimit }) {
  const client = gscAuth.getAuthClient();

  try {
    const response = await client.request({
      url: SEARCH_ANALYTICS_URL(siteUrl),
      method: 'POST',
      data: { startDate, endDate, dimensions, rowLimit: rowLimit || DEFAULT_ROW_LIMIT },
      timeout: config.gsc.timeoutMs,
    });
    return response.data || {};
  } catch (err) {
    // GaxiosError shape: err.response.status / err.response.data.error.message.
    // Google's error bodies describe the failure (bad property, insufficient
    // permission, quota) — they never echo back the credentials used to ask.
    const status = err.response?.status;
    const googleMessage = err.response?.data?.error?.message;
    logger.error('GSC Search Analytics request failed.', {
      status,
      message: googleMessage || err.message,
      siteUrl,
    });

    if (status === 401 || status === 403) {
      throw new ApiError(
        502,
        `Google Search Console rejected this request (${status}): ${
          googleMessage || 'check that the service account has access to this property.'
        }`,
        { code: 'GSC_AUTH_ERROR', details: { provider: 'gsc', status } }
      );
    }

    throw new ApiError(502, `GSC Search Analytics request failed: ${googleMessage || err.message}`, {
      code: 'GSC_UPSTREAM_ERROR',
      details: { provider: 'gsc', status },
      cause: err,
    });
  }
}

/**
 * Persists one real GSC response as a queryable `GscSnapshot` + its
 * `GscRow`s. Every returned row is stored — see the migration header for why
 * this is never trimmed down to "just our own numbers": there is no
 * "competitor" concept in GSC data the way there is in SERP data, but the
 * same "keep the full observation" philosophy applies.
 *
 * Best-effort by contract, same as saveSerpSnapshot: a storage failure here
 * must never break the calling function's existing return behavior — callers
 * wrap this in a try/catch and only log on failure.
 *
 * @param {object} input
 * @param {string} input.siteUrl
 * @param {string} input.startDate
 * @param {string} input.endDate
 * @param {string[]} input.dimensions Ordered — must match the order requested from Google.
 * @param {object} input.body Raw GSC response body (already fetched by queryGscApi).
 * @param {string} input.sourceFunction
 * @returns {Promise<object>} The snapshot row (existing or newly created), with `.rows` attached.
 */
async function saveGscSnapshot({ siteUrl, startDate, endDate, dimensions, body, sourceFunction }) {
  // Lazy require, same reason as serp.js: keeps this module importable
  // without pulling in the models layer for callers that never hit this path.
  const { GscSnapshot, GscRow } = require('../models');

  const dimensionsKey = JSON.stringify(dimensions);

  // Windowed on created_at (our write time), not the request's date range —
  // dedup is "did we already fetch this exact snapshot a moment ago", not
  // anything about the data's own date range.
  const candidates = await GscSnapshot.findAll({
    where: {
      site_url: siteUrl,
      date_range_start: startDate,
      date_range_end: endDate,
      created_at: { [Op.gte]: new Date(Date.now() - SNAPSHOT_DEDUP_WINDOW_MS) },
    },
    order: [['created_at', 'DESC']],
    include: [{ model: GscRow, as: 'rows' }],
  });
  const existing = candidates.find((c) => JSON.stringify(c.dimensions) === dimensionsKey);
  if (existing) return existing;

  const rawRows = Array.isArray(body.rows) ? body.rows : [];

  const snapshot = await GscSnapshot.create({
    site_url: siteUrl,
    date_range_start: startDate,
    date_range_end: endDate,
    dimensions,
    fetched_at: new Date(),
    provider: 'gsc',
    source_function: sourceFunction,
  });

  const rowRecords = rawRows.map((row) => {
    const keyed = {};
    dimensions.forEach((dim, i) => {
      keyed[dim] = row.keys?.[i] ?? null;
    });
    return {
      snapshot_id: snapshot.id,
      query: keyed.query ? toPlainText(String(keyed.query)).slice(0, 500) : null,
      page: keyed.page ? String(keyed.page).slice(0, 2000) : null,
      country: keyed.country || null,
      device: keyed.device || null,
      search_appearance: keyed.searchAppearance || null,
      clicks: Number.isFinite(row.clicks) ? row.clicks : 0,
      impressions: Number.isFinite(row.impressions) ? row.impressions : 0,
      ctr: Number.isFinite(row.ctr) ? row.ctr : 0,
      position: Number.isFinite(row.position) ? row.position : null,
      date: keyed.date || null,
    };
  });

  if (rowRecords.length > 0) {
    await GscRow.bulkCreate(rowRecords);
  }

  snapshot.rows = await GscRow.findAll({ where: { snapshot_id: snapshot.id }, order: [['clicks', 'DESC']] });
  return snapshot;
}

/**
 * Fetches Search Analytics for a site and persists it. The only function
 * that actually talks to Google — everything downstream (the SEO Analyst
 * tool) reads what this already stored.
 *
 * @param {object} input
 * @param {string} [input.siteUrl] Defaults to config.gsc.siteUrl.
 * @param {string} input.startDate YYYY-MM-DD.
 * @param {string} input.endDate YYYY-MM-DD.
 * @param {string[]} [input.dimensions] Defaults to DEFAULT_DIMENSIONS.
 * @returns {Promise<object>} The persisted snapshot, with `.rows` attached.
 */
async function fetchSearchAnalytics({ siteUrl, startDate, endDate, dimensions } = {}) {
  gscAuth.assertEnabled('GSC performance data');

  const site = siteUrl || config.gsc.siteUrl;
  const dims = Array.isArray(dimensions) && dimensions.length > 0 ? dimensions : [...DEFAULT_DIMENSIONS];

  if (!startDate || !endDate) {
    throw ApiError.badRequest('startDate and endDate are required to fetch Search Analytics.', {
      code: 'DATE_RANGE_REQUIRED',
    });
  }

  const body = await queryGscApi({ siteUrl: site, startDate, endDate, dimensions: dims });

  try {
    return await saveGscSnapshot({
      siteUrl: site,
      startDate,
      endDate,
      dimensions: dims,
      body,
      sourceFunction: 'fetchSearchAnalytics',
    });
  } catch (err) {
    // Storage failure must not make an otherwise-successful GSC fetch look
    // like a failure — log and re-raise a clearly-labelled persistence error
    // rather than silently returning unpersisted data the tool could never find.
    logger.error('GSC snapshot persistence failed after a successful API response.', { message: err.message });
    throw new ApiError(500, `GSC data was fetched but could not be saved: ${err.message}`, {
      code: 'GSC_PERSISTENCE_ERROR',
      cause: err,
    });
  }
}

module.exports = {
  isEnabled: gscAuth.isEnabled,
  assertEnabled: gscAuth.assertEnabled,
  fetchSearchAnalytics,
  saveGscSnapshot,
  lastNDays,
  DEFAULT_DIMENSIONS,
  DEFAULT_ROW_LIMIT,
  SNAPSHOT_DEDUP_WINDOW_MS,
};
