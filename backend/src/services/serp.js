'use strict';

/**
 * SerpAPI integration — rank checking and web fact-grounding.
 *
 * ---------------------------------------------------------------------------
 * THE HEADLINE REQUIREMENT: THIS IS OPTIONAL
 * ---------------------------------------------------------------------------
 * Section 1 of the spec says the app must be fully functional with SerpAPI
 * switched off, and that shapes every function here:
 *
 *   - `config.serp.enabled` is true only when the flag AND a key are both
 *     present, so a half-configured deployment behaves like a disabled one
 *     rather than failing at call time with an auth error.
 *   - The two user-facing endpoints throw `ApiError.featureDisabled` (503,
 *     FEATURE_DISABLED) when it is off. That is a deliberate, documented answer
 *     the frontend can branch on — not an exception leaking from axios.
 *   - `groundFacts` is the one place SERP touches the core pipeline, and
 *     services/generation.js calls it defensively: grounding is best-effort, so
 *     a SERP outage degrades the article's sourcing and never fails the
 *     generation. See `safeGroundFacts`.
 *
 * ---------------------------------------------------------------------------
 * WHY WE DO NOT SCRAPE GOOGLE OURSELVES
 * ---------------------------------------------------------------------------
 * SerpAPI is a paid proxy that handles consent pages, geo, and blocking. Doing
 * it in-house means maintaining a scraper against an adversary. That is why the
 * feature is behind a key at all, and why "off" has to be a first-class state.
 */

const axios = require('axios');

const config = require('../config');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { toPlainText } = require('./sanitize');

/** Rank checks look this deep. Beyond the first 100 the position is not actionable. */
const RANK_CHECK_DEPTH = 100;

/** Organic results folded into a grounding brief. Enough context, bounded cost. */
const GROUNDING_RESULTS = 8;

/** Per-field cap on scraped snippet text, before the prompt-level cap applies. */
const SNIPPET_MAX_CHARS = 400;

/** Google locale defaults. Divinetalk's audience is Indian; these are the sane defaults. */
const DEFAULT_LOCALE = Object.freeze({ gl: 'in', hl: 'en' });

/**
 * Whether SERP-backed features are usable.
 *
 * Exported as a function rather than read from config at each call site so the
 * controllers, the generation pipeline and the OpenAPI docs all ask the same
 * question the same way.
 *
 * @returns {boolean}
 */
function isEnabled() {
  return config.serp.enabled === true;
}

/**
 * Throws the standard 503 when the feature is off.
 * @param {string} feature Human name of what was attempted.
 */
function assertEnabled(feature) {
  if (isEnabled()) return;
  throw ApiError.featureDisabled(
    `${feature} needs the SerpAPI integration, which is switched off for this deployment. ` +
      'Set SERPAPI_ENABLED=true and provide SERPAPI_KEY to enable it.',
    {
      details: {
        feature: 'serp_api',
        flag_enabled: config.serp.flagEnabled,
        has_key: config.serp.hasKey,
      },
    }
  );
}

/**
 * One SerpAPI GET, with the shared timeout and error translation.
 *
 * @private
 * @param {object} params Query parameters, minus the API key.
 * @param {string} operation For logs and error details.
 * @returns {Promise<object>} Parsed JSON body.
 */
async function request(params, operation) {
  try {
    const response = await axios.get(config.serp.baseUrl, {
      params: { ...params, api_key: config.serp.apiKey },
      timeout: config.serp.timeoutMs,
      // SerpAPI reports quota and bad-parameter problems as a JSON `error` field.
      // Accepting every status and inspecting the body means those surface with
      // SerpAPI's own message instead of a bare "Request failed with status 401".
      validateStatus: () => true,
      responseType: 'json',
    });

    const body = response.data;

    if (response.status >= 400 || body?.error) {
      throw ApiError.upstream(
        `SerpAPI returned an error: ${body?.error || `HTTP ${response.status}`}`,
        {
          code: 'UPSTREAM_ERROR',
          details: { provider: 'serpapi', operation, status: response.status },
        }
      );
    }

    return body || {};
  } catch (err) {
    if (err instanceof ApiError) throw err;

    // A timeout here is the common case (SerpAPI waits on Google). Distinguish it
    // so the UI can offer "retry" rather than "something went wrong".
    const timedOut = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT';
    logger.error(`SerpAPI ${operation} failed`, {
      code: err.code,
      status: err.response?.status,
      message: err.message,
    });

    throw new ApiError(
      timedOut ? 504 : 502,
      timedOut
        ? `SerpAPI did not respond within ${config.serp.timeoutMs}ms.`
        : `SerpAPI request failed: ${err.message}`,
      {
        code: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR',
        details: { provider: 'serpapi', operation },
        cause: err,
      }
    );
  }
}

/** Strips a URL down to a comparable hostname. */
function hostOf(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === '') return '';
  const withScheme = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Looks up where a domain ranks for a keyword.
 *
 * Matching is on hostname with the `www.` prefix normalised away, and a
 * subdomain of the target counts as a match — `blog.divinetalk.com` ranking is
 * the answer the user wanted when they typed `divinetalk.com`.
 *
 * When `blogId` is supplied the result is written back to the row, because the
 * dashboard's rank column reads the stored value rather than re-querying a paid
 * API on every page load.
 *
 * @param {object} input
 * @param {string} input.keyword Search query.
 * @param {string} input.domain Domain to look for.
 * @param {number|string} [input.blogId] Persist the result against this blog.
 * @param {string} [input.country] Google `gl` code.
 * @returns {Promise<{keyword: string, domain: string, position: number|null, url: string|null, total_results_scanned: number, checked_at: string, blog_id: number|null}>}
 */
async function checkRank({ keyword, domain, blogId, country } = {}) {
  assertEnabled('Rank checking');

  const query = String(keyword || '').trim();
  const target = hostOf(domain);
  if (query === '') {
    throw ApiError.badRequest('A keyword is required to check a rank.', { code: 'KEYWORD_REQUIRED' });
  }
  if (target === '') {
    throw ApiError.badRequest('A valid domain is required to check a rank.', { code: 'DOMAIN_REQUIRED' });
  }

  const body = await request(
    {
      engine: 'google',
      q: query,
      num: RANK_CHECK_DEPTH,
      gl: country || DEFAULT_LOCALE.gl,
      hl: DEFAULT_LOCALE.hl,
    },
    'checkRank'
  );

  const organic = Array.isArray(body.organic_results) ? body.organic_results : [];

  let position = null;
  let url = null;
  for (const result of organic) {
    const host = hostOf(result?.link);
    if (host === target || host.endsWith(`.${target}`)) {
      // `position` from SerpAPI is the true SERP position; the array index is not,
      // because ads and features are excluded from organic_results.
      position = Number.isFinite(result?.position) ? result.position : organic.indexOf(result) + 1;
      url = result?.link || null;
      break;
    }
  }

  const checkedAt = new Date();

  if (blogId !== undefined && blogId !== null) {
    // Required lazily so this module stays importable by tests that have not
    // built a schema (mirrors the pattern in middleware/auth.js).
    const { Blog } = require('../models');
    const blog = await Blog.findByPk(blogId);
    if (!blog) {
      throw ApiError.notFound(`Blog ${blogId} was not found, so the rank could not be saved.`);
    }
    blog.serp_rank_keyword = query;
    blog.serp_rank_position = position;
    blog.serp_rank_checked_at = checkedAt;
    await blog.save();
  }

  return {
    keyword: query,
    domain: target,
    position,
    url,
    total_results_scanned: organic.length,
    checked_at: checkedAt.toISOString(),
    blog_id: blogId === undefined || blogId === null ? null : Number(blogId),
  };
}

/**
 * Gathers current web facts to ground an article in.
 *
 * Returns both a structured `sources` array (persisted alongside the generation
 * config, so an article's sourcing is auditable after the fact) and a flattened
 * `brief` string, which is what actually goes into the prompt.
 *
 * Everything scraped is run through `toPlainText` before it goes anywhere near
 * a prompt or a response body: these snippets are third-party HTML, and the
 * threat model in services/sanitize.js applies to them in full.
 *
 * @param {object} input
 * @param {string} input.topic
 * @param {string} [input.keyword] Falls back to the topic.
 * @param {string} [input.country]
 * @returns {Promise<{query: string, sources: Array<{title: string, url: string, snippet: string}>, related_questions: string[], brief: string, fetched_at: string}>}
 */
async function groundFacts({ topic, keyword, country } = {}) {
  assertEnabled('Web fact grounding');

  const query = String(keyword || topic || '').trim();
  if (query === '') {
    throw ApiError.badRequest('A topic or keyword is required for fact grounding.', {
      code: 'TOPIC_REQUIRED',
    });
  }

  const body = await request(
    {
      engine: 'google',
      q: query,
      num: GROUNDING_RESULTS,
      gl: country || DEFAULT_LOCALE.gl,
      hl: DEFAULT_LOCALE.hl,
    },
    'groundFacts'
  );

  const sources = (Array.isArray(body.organic_results) ? body.organic_results : [])
    .slice(0, GROUNDING_RESULTS)
    .map((result) => ({
      title: toPlainText(String(result?.title || '')).slice(0, 200),
      url: typeof result?.link === 'string' ? result.link : '',
      snippet: toPlainText(String(result?.snippet || '')).slice(0, SNIPPET_MAX_CHARS),
    }))
    .filter((source) => source.title !== '' || source.snippet !== '');

  const relatedQuestions = (Array.isArray(body.related_questions) ? body.related_questions : [])
    .map((entry) => toPlainText(String(entry?.question || '')).slice(0, 200))
    .filter(Boolean);

  // The answer box, when Google shows one, is the highest-signal single fact
  // available — worth putting first in the brief rather than burying it.
  const answerBox = body.answer_box
    ? toPlainText(
        String(body.answer_box.answer || body.answer_box.snippet || body.answer_box.result || '')
      ).slice(0, SNIPPET_MAX_CHARS)
    : '';

  const brief = [
    answerBox ? `Featured answer: ${answerBox}` : '',
    sources.length
      ? sources.map((s, i) => `${i + 1}. ${s.title}${s.snippet ? ` — ${s.snippet}` : ''}`).join('\n')
      : '',
    relatedQuestions.length ? `People also ask:\n${relatedQuestions.map((q) => `- ${q}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    query,
    sources,
    related_questions: relatedQuestions,
    brief,
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Best-effort grounding for the generation pipeline.
 *
 * Returns null instead of throwing, for two distinct reasons that both end the
 * same way: the feature may be switched off (a normal state, not an error), or
 * SerpAPI may be down (an error, but not one worth failing a paid article
 * generation over). Either way the article is written without grounding, which
 * is what happens on every deployment that never enabled SERP at all.
 *
 * @param {{topic: string, keyword?: string, country?: string}} input
 * @returns {Promise<object|null>}
 */
async function safeGroundFacts(input) {
  if (!isEnabled()) return null;
  try {
    return await groundFacts(input);
  } catch (err) {
    logger.warn('Web grounding failed; continuing without it.', {
      code: err.code,
      message: err.message,
    });
    return null;
  }
}

/**
 * Fetches SERP data for a keyword.
 * Used for keyword-first autopilot flow.
 *
 * @param {string} keyword Search query.
 * @returns {Promise<{top_10_results: Array<{title: string, snippet: string, url: string}>, people_also_ask: string[], related_searches: string[]}>}
 */
async function fetchSerpDataForKeyword(keyword) {
  assertEnabled('Keyword fact grounding');

  const query = String(keyword || '').trim();
  if (query === '') {
    throw ApiError.badRequest('A keyword is required.', { code: 'KEYWORD_REQUIRED' });
  }

  const body = await request(
    {
      engine: 'google',
      q: query,
      num: 10,
      gl: DEFAULT_LOCALE.gl,
      hl: DEFAULT_LOCALE.hl,
    },
    'fetchSerpDataForKeyword'
  );

  const top_10_results = (Array.isArray(body.organic_results) ? body.organic_results : [])
    .slice(0, 10)
    .map((result) => ({
      title: toPlainText(String(result?.title || '')).slice(0, 200),
      snippet: toPlainText(String(result?.snippet || '')).slice(0, SNIPPET_MAX_CHARS),
      url: typeof result?.link === 'string' ? result.link : '',
    }))
    .filter((source) => source.title !== '' || source.snippet !== '');

  const people_also_ask = (Array.isArray(body.related_questions) ? body.related_questions : [])
    .map((entry) => toPlainText(String(entry?.question || '')).slice(0, 200))
    .filter(Boolean);

  const related_searches = (Array.isArray(body.related_searches) ? body.related_searches : [])
    .map((entry) => toPlainText(String(entry?.query || '')).slice(0, 200))
    .filter(Boolean);

  return {
    top_10_results,
    people_also_ask,
    related_searches,
  };
}

module.exports = {
  isEnabled,
  assertEnabled,
  checkRank,
  groundFacts,
  safeGroundFacts,
  fetchSerpDataForKeyword,
  hostOf,
  RANK_CHECK_DEPTH,
  GROUNDING_RESULTS,
  SNIPPET_MAX_CHARS,
  DEFAULT_LOCALE,
};
