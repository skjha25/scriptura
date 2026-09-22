'use strict';

/**
 * Tools available to the SEO Analyst Agent — read-only by design.
 *
 * There is no persisted analytics setting anywhere in the platform today (no
 * "default months window" or similar), so unlike every other agent in this
 * app, there is nothing here to propose+apply. The analytics tools just wrap
 * the existing analyticsService reads and hand the JSON straight to the model
 * to reason over.
 *
 * `get_serp_snapshot` is different in one important way: it reads
 * `serp_snapshots`/`serp_results` (see services/serp.js's saveSerpSnapshot)
 * and NEVER calls SerpAPI itself. Real SERP data is metered and paid for, so
 * the only place a live request happens is the existing checkRank /
 * fetchSerpDataForKeyword flows; this tool is a free, instant read of
 * whatever those already fetched. That also means it can honestly answer
 * "no data" for a keyword nothing has checked yet, rather than silently
 * making a request the admin didn't ask for.
 *
 * `get_gsc_performance` is the same shape again, for Google Search Console:
 * it reads `gsc_snapshots`/`gsc_rows` (services/gsc.js's saveGscSnapshot) and
 * NEVER calls Google itself — the agent has no path to a live Google API call
 * under any circumstances. Also gone entirely when GSC isn't configured
 * (services/gscAuth.js's isEnabled() is false), same fail-open shape as
 * get_serp_snapshot: the tool still answers, just with a clear "no data"
 * message, never a crash.
 *
 * IMPORTANT — GSC and SERP are DIFFERENT properties, never conflated:
 * get_serp_snapshot tracks divinetalk.in (the blog/content site); GSC is
 * verified for, and only ever reports on, divinetalk.in (the main product/
 * consultation site). Every get_gsc_performance response says so explicitly
 * so the model never treats one property's numbers as if they were the
 * other's.
 */

const MIN_MONTHS = 1;
const MAX_MONTHS = 36;
const DEFAULT_MONTHS = 7;

const getAnalyticsOverview = {
  name: 'get_analytics_overview',
  description:
    'Read the Dashboard analytics overview — totals, status breakdown, publishing cadence, ' +
    'word-count/SEO/AEO/GEO score trends and distributions, top keywords, category mix, and recent ' +
    'activity, over a trailing window of months. Use this to answer any question about platform trends.',
  input_schema: {
    type: 'object',
    properties: {
      months: {
        type: 'integer',
        minimum: MIN_MONTHS,
        maximum: MAX_MONTHS,
        description: `Trailing window in months (default ${DEFAULT_MONTHS}).`,
      },
    },
  },
  async execute({ months } = {}) {
    const n = Number.isInteger(months) && months >= MIN_MONTHS && months <= MAX_MONTHS ? months : DEFAULT_MONTHS;
    // Lazy require: keeps this module loadable without pulling in the models
    // layer for callers that never hit this path.
    const analyticsService = require('../../analyticsService');
    const overview = await analyticsService.getOverview({ months: n });
    return { type: 'read', overview };
  },
};

const getInFlightGenerations = {
  name: 'get_in_flight_generations',
  description: 'Read which blogs are currently queued or generating right now (up to 50), for "what is running right now" questions.',
  input_schema: { type: 'object', properties: {} },
  async execute() {
    const analyticsService = require('../../analyticsService');
    const inFlight = await analyticsService.getInFlightGenerations();
    return { type: 'read', inFlight };
  },
};

/** Results returned to the model, capped so a 100-deep checkRank snapshot doesn't dump its whole depth. */
const MAX_RESULTS_RETURNED = 10;

const getSerpSnapshot = {
  name: 'get_serp_snapshot',
  description:
    'Read the most recent stored real-Google SERP snapshot for a keyword: organic ranking positions, ' +
    'every competitor domain that appeared, and which SERP features were present (AI Overview, People ' +
    'Also Ask, Related Searches, etc). This is stored evidence from an actual SerpAPI response, not a ' +
    'live lookup — it never calls SerpAPI, so it can only answer for a keyword someone has already ' +
    'checked. If no snapshot exists it says so explicitly; never guess or estimate a ranking position ' +
    'from general knowledge instead of calling this tool.',
  input_schema: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description: 'The search query to look up, e.g. "online astrology consultation".',
      },
      location: { type: 'string', description: 'Google country code the snapshot was taken for. Defaults to "in".' },
      language: { type: 'string', description: 'Google language code the snapshot was taken for. Defaults to "en".' },
      device: { type: 'string', description: 'Device the snapshot was taken on. Defaults to "desktop".' },
    },
    required: ['keyword'],
  },
  async execute({ keyword, location, language, device } = {}) {
    const query = String(keyword || '').trim();
    if (query === '') {
      return { type: 'read', found: false, message: 'A keyword is required to look up a SERP snapshot.' };
    }

    // Lazy require, same reason as the tools above: keeps this module
    // loadable without pulling in the models layer for callers that never
    // hit this specific tool.
    const { SerpSnapshot, SerpResult } = require('../../../models');
    const { normalizeKeyword } = require('../../serp');
    const { INTERNAL_HOSTS } = require('../../seoScore');

    const snapshot = await SerpSnapshot.findOne({
      where: {
        normalized_keyword: normalizeKeyword(query),
        location: location || 'in',
        language: language || 'en',
        device: device || 'desktop',
      },
      order: [['searched_at', 'DESC']],
      include: [{ model: SerpResult, as: 'results', separate: true, order: [['position', 'ASC']] }],
    });

    if (!snapshot) {
      return { type: 'read', found: false, keyword: query, message: 'No SERP snapshot available for this query.' };
    }

    const isOurDomain = (domain) =>
      Boolean(domain) && INTERNAL_HOSTS.some((host) => domain === host || domain.endsWith(`.${host}`));
    const ourResult = snapshot.results.find((r) => isOurDomain(r.domain));

    const features = snapshot.serp_features || {};
    const activeFeatures = [
      features.has_ai_overview && 'AI Overview',
      features.has_answer_box && 'Featured snippet / answer box',
      features.has_people_also_ask && 'People Also Ask',
      features.has_related_searches && 'Related Searches',
      features.has_knowledge_graph && 'Knowledge Graph',
      features.has_local_results && 'Local Pack',
      features.has_ads && 'Ads',
    ].filter(Boolean);

    return {
      type: 'read',
      found: true,
      keyword: snapshot.keyword,
      snapshot_id: snapshot.id,
      searched_at: snapshot.searched_at.toISOString(),
      location: snapshot.location,
      language: snapshot.language,
      device: snapshot.device,
      total_results_estimate: snapshot.total_results,
      results_stored_count: snapshot.results.length,
      // Not the full stored depth (checkRank stores up to 100) — enough evidence to reason over,
      // not a raw API dump. `domains_in_snapshot` below still covers the full stored list, so a
      // named competitor beyond the top MAX_RESULTS_RETURNED is still findable.
      results: snapshot.results.slice(0, MAX_RESULTS_RETURNED).map((r) => ({
        position: r.position,
        title: r.title,
        url: r.url,
        domain: r.domain,
        snippet: r.snippet,
      })),
      our_domain: ourResult
        ? { found: true, position: ourResult.position, url: ourResult.url, title: ourResult.title }
        : {
            found: false,
            note: `Not present in this snapshot's stored results (depth ${snapshot.results.length}). This does not mean the domain does not rank at all — only that it wasn't in what was captured.`,
          },
      domains_in_snapshot: [...new Set(snapshot.results.map((r) => r.domain).filter(Boolean))],
      serp_features: activeFeatures,
      note:
        "Positions reflect this snapshot only, taken at searched_at — not a live, continuously-updated " +
        "rank. A domain not listed in results/domains_in_snapshot was not found in this snapshot's " +
        'stored results; that does not establish it does not rank at all, and SERP position alone does ' +
        'not explain WHY a domain ranks where it does (backlinks, content depth, and domain authority ' +
        'are separate data this tool does not have).',
    };
  },
};

const GSC_NO_DATA_MESSAGE =
  'GSC data is not currently available. GSC integration is disabled or no snapshot has been collected.';
const GSC_TOP_N = 10;

/** "sc-domain:divinetalk.in" / "https://divinetalk.in/" -> "divinetalk.in", for a human-readable label. */
function cleanSiteLabel(siteUrl) {
  if (!siteUrl) return '';
  return siteUrl.replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** Impression-weighted average position — the same rollup GSC's own UI uses, not a plain per-row average. */
function weightedAveragePosition(rows) {
  const withPosition = rows.filter((r) => Number.isFinite(r.position) && r.impressions > 0);
  const totalImpressions = withPosition.reduce((sum, r) => sum + r.impressions, 0);
  if (totalImpressions === 0) return null;
  const weighted = withPosition.reduce((sum, r) => sum + r.position * r.impressions, 0);
  return weighted / totalImpressions;
}

/** Groups rows by one dimension field, sums clicks/impressions, and returns the top N by clicks. */
function topBy(rows, field, limit) {
  const groups = new Map();
  for (const row of rows) {
    const key = row[field];
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { value: key, clicks: 0, impressions: 0, positionRows: [] });
    const entry = groups.get(key);
    entry.clicks += row.clicks;
    entry.impressions += row.impressions;
    entry.positionRows.push(row);
  }
  return [...groups.values()]
    .map((entry) => ({
      [field]: entry.value,
      clicks: entry.clicks,
      impressions: entry.impressions,
      ctr: entry.impressions > 0 ? entry.clicks / entry.impressions : 0,
      avg_position: weightedAveragePosition(entry.positionRows),
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, limit);
}

const getGscPerformance = {
  name: 'get_gsc_performance',
  description:
    'Read stored Google Search Console performance data for divinetalk.in (our main product/consultation ' +
    'site) — real queries, pages, clicks, impressions, CTR, and average position, for a date range that ' +
    'has already been fetched. This is a DIFFERENT property from get_serp_snapshot, which tracks ' +
    'divinetalk.in (the blog/content site) — never present GSC and SERP numbers as if they describe the ' +
    'same site. This tool reads stored evidence only; it never calls Google, so it can only answer for a ' +
    'date range someone has already fetched, and it answers "no data" (rather than an error) when GSC is ' +
    'not configured at all. Never guess or estimate GSC numbers from general knowledge.',
  input_schema: {
    type: 'object',
    properties: {
      start_date: {
        type: 'string',
        description: 'YYYY-MM-DD. Omit to use the most recently fetched snapshot.',
      },
      end_date: {
        type: 'string',
        description: 'YYYY-MM-DD. Omit to use the most recently fetched snapshot.',
      },
      query: { type: 'string', description: 'Filter to one exact search query (case-insensitive).' },
      page: { type: 'string', description: 'Filter to one exact page URL (case-insensitive).' },
      country: { type: 'string', description: 'Filter to one country code, e.g. "ind".' },
      device: { type: 'string', description: 'Filter to one device: DESKTOP, MOBILE, or TABLET.' },
    },
  },
  async execute({ start_date, end_date, query, page, country, device } = {}) {
    // Lazy requires, same reason as every tool above: keeps this module
    // loadable without pulling in config/models for callers that never hit
    // this specific tool.
    const gscAuth = require('../../gscAuth');
    if (!gscAuth.isEnabled()) {
      return { type: 'read', found: false, data_source: 'Google Search Console', message: GSC_NO_DATA_MESSAGE };
    }

    const config = require('../../../config');
    const { GscSnapshot, GscRow } = require('../../../models');

    const where = { site_url: config.gsc.siteUrl };
    if (start_date) where.date_range_start = start_date;
    if (end_date) where.date_range_end = end_date;

    const snapshot = await GscSnapshot.findOne({
      where,
      order: [['created_at', 'DESC']],
      include: [{ model: GscRow, as: 'rows', separate: true, order: [['clicks', 'DESC']] }],
    });

    if (!snapshot) {
      return {
        type: 'read',
        found: false,
        data_source: 'Google Search Console',
        site: cleanSiteLabel(config.gsc.siteUrl),
        message: GSC_NO_DATA_MESSAGE,
      };
    }

    let rows = snapshot.rows;
    if (query) rows = rows.filter((r) => r.query && r.query.toLowerCase() === query.toLowerCase());
    if (page) rows = rows.filter((r) => r.page && r.page.toLowerCase() === page.toLowerCase());
    if (country) rows = rows.filter((r) => r.country && r.country.toLowerCase() === country.toLowerCase());
    if (device) rows = rows.filter((r) => r.device && r.device.toLowerCase() === device.toLowerCase());

    const totalClicks = rows.reduce((sum, r) => sum + r.clicks, 0);
    const totalImpressions = rows.reduce((sum, r) => sum + r.impressions, 0);
    const siteLabel = cleanSiteLabel(snapshot.site_url);

    return {
      type: 'read',
      found: true,
      data_source: 'Google Search Console',
      site: siteLabel,
      date_range: { start: snapshot.date_range_start, end: snapshot.date_range_end },
      dimensions: snapshot.dimensions,
      filters_applied: {
        query: query || null,
        page: page || null,
        country: country || null,
        device: device || null,
      },
      rows_matched: rows.length,
      totals: {
        clicks: totalClicks,
        impressions: totalImpressions,
        ctr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
        average_position: weightedAveragePosition(rows),
      },
      top_queries: topBy(rows, 'query', GSC_TOP_N),
      top_pages: topBy(rows, 'page', GSC_TOP_N),
      snapshot_id: snapshot.id,
      fetched_at: snapshot.fetched_at.toISOString(),
      note:
        `DATA SOURCE: Google Search Console. SITE: ${siteLabel}. This is our main product/consultation ` +
        'site, a DIFFERENT property from the SERP-tracked domain (divinetalk.in — see get_serp_snapshot). ' +
        'Never present these two data sources as if they describe the same site.',
    };
  },
};

/**
 * P3-B: "does this type of recommendation tend to work?" — reads
 * services/agents/recommendationEvaluation.js's real, code-computed
 * breakdown over already-evaluated recommendation_outcomes rows (P2-B/P2-C).
 * Same shape as get_serp_snapshot/get_gsc_performance: reads stored,
 * deterministic evidence only — this tool never computes a rate itself and
 * never calls an AI provider; every number in the response is exactly what
 * recommendationEvaluation.js returned, so the model can only narrate
 * numbers it was actually handed, never invent or adjust one.
 */
const getRecommendationEffectiveness = {
  name: 'get_recommendation_effectiveness',
  description:
    'Read how often a type of past recommendation actually improved its target metric, based on real, ' +
    'already-evaluated outcomes (see get_serp_snapshot/get_gsc_performance for the underlying evidence ' +
    'these summaries are built from). This reads stored, deterministic counts only — it never estimates, ' +
    'guesses, or adjusts a rate, and explicitly flags low confidence when the sample is too small to mean ' +
    'much (confidence_note:"insufficient_sample"). Use this to answer "does this kind of change tend to ' +
    'work" as a general pattern — never restate a rate here as a guarantee for any single future ' +
    'recommendation, and never invent a rate for a dimension_value not present in the response.',
  input_schema: {
    type: 'object',
    properties: {
      group_by: {
        type: 'string',
        enum: ['action_type', 'recommendation_type'],
        description: 'What to break the results down by. Defaults to action_type (e.g. "blog.update_seo_fields").',
      },
      action_type: {
        type: 'string',
        description: 'Optional: narrow to one specific action_type, e.g. "blog.update_seo_fields" or "blog.update_block".',
      },
      recommendation_type: {
        type: 'string',
        description: 'Optional: narrow to one specific recommendation_type (the tool name that produced it), e.g. "recommend_seo_action".',
      },
      agent_name: {
        type: 'string',
        description: 'Optional: narrow to recommendations from one agent, e.g. "seo_analyst_agent".',
      },
      since_date: {
        type: 'string',
        description: 'Optional: YYYY-MM-DD. Only include outcomes evaluated on/after this date.',
      },
    },
  },
  async execute({ group_by, action_type, recommendation_type, agent_name, since_date } = {}) {
    const { getActionTypeEffectiveness } = require('../recommendationEvaluation');

    const breakdown = await getActionTypeEffectiveness({
      groupBy: group_by,
      actionType: action_type,
      recommendationType: recommendation_type,
      agentName: agent_name,
      sinceDate: since_date,
    });

    return {
      type: 'read',
      group_by: group_by || 'action_type',
      filters_applied: {
        action_type: action_type || null,
        recommendation_type: recommendation_type || null,
        agent_name: agent_name || null,
        since_date: since_date || null,
      },
      breakdown,
      note:
        'DATA SOURCE: stored, already-evaluated recommendation_outcomes rows — every count here is real, ' +
        'never estimated. A dimension_value with a small sample_size (confidence_note:"insufficient_sample") ' +
        'should not be treated as a reliable rate. This describes historical pattern, not a guarantee for ' +
        'any specific future recommendation.',
    };
  },
};

module.exports = {
  TOOLS: [getAnalyticsOverview, getInFlightGenerations, getSerpSnapshot, getGscPerformance, getRecommendationEffectiveness],
  // P2-B: outcomeMeasurement.js reuses this exact formula for its GSC
  // baseline capture, rather than re-deriving impression-weighted average
  // position a second time — one rollup, two callers.
  weightedAveragePosition,
};
