'use strict';

/**
 * P2-B: captures the deterministic baseline needed to later evaluate whether
 * an already-completed recommendation action's target metric moved.
 *
 * ---------------------------------------------------------------------------
 * WHERE THIS FITS IN THE LIFECYCLE
 * ---------------------------------------------------------------------------
 * Recommendation → Approval → Action → Successful Execution/Completion →
 * [THIS FILE: Baseline Capture] → Observation Window → (P2-C, not built
 * here) Future Measurement → Outcome.
 *
 * Called from exactly two places, both SUCCESS paths only:
 * recommendationActions.js's `completeAction()` (manual) and `executeAction()`
 * (automated, after the real Blog mutation has already succeeded). Never
 * called from `failAction`/`cancelAction`/the internal failure-path
 * `transition()` calls inside `executeAction` — a failed or cancelled action
 * structurally cannot reach this file.
 *
 * Best-effort by contract, same philosophy as recommendations.js's
 * recordRecommendation and runAgentTurn.js's recordKnowledgeUsage: a capture
 * failure must never change completeAction's/executeAction's own return
 * value or the action's own terminal status. Every exported entry point
 * catches its own errors and returns null on failure rather than throwing.
 *
 * ---------------------------------------------------------------------------
 * EVIDENCE IS NEVER DUPLICATED
 * ---------------------------------------------------------------------------
 * This file NEVER calls SerpAPI or Google directly — it only calls the
 * existing services/serp.js#checkRank and services/gsc.js#fetchSearchAnalytics,
 * both of which already persist via saveSerpSnapshot/saveGscSnapshot. What
 * gets stored on the outcome row is (a) POINTERS to the snapshot rows those
 * calls already created (`baseline_evidence_refs`), and (b) a small set of
 * already-computed numbers extracted from that same response
 * (`baseline_metric_snapshot`) — never a copy of the raw snapshot/row data.
 *
 * ---------------------------------------------------------------------------
 * NEVER FABRICATED, NEVER CAUSAL
 * ---------------------------------------------------------------------------
 * A metric source is only ever included when it actually resolved — no
 * evidence source is ever fabricated as "unavailable but assumed zero/same".
 * If nothing resolves at all, no outcome row is created (not every
 * recommendation is metric-observable). This file classifies nothing as
 * "the action caused X" — it only records the measured state immediately
 * after a successful execution/completion. Whether that state later moved,
 * and in which direction, is P2-C's job (not built here).
 */

const logger = require('../../utils/logger');

/** Falls back to this when the parent recommendation never set (or set an invalid) observation_window_days. */
const DEFAULT_OBSERVATION_WINDOW_DAYS = 14;

/** Small, safe range for a same-moment GSC baseline read — matches the range used for this app's own live GSC verification. */
const GSC_BASELINE_WINDOW_DAYS = 3;

/**
 * Pointer types this file writes into baseline_evidence_refs — a local
 * vocabulary, distinct from sharedRecommendationTools.js's LLM-facing
 * EVIDENCE_REF_TYPES. Those are unvalidated because an LLM supplies them;
 * these are always written by this deterministic code, never LLM-supplied.
 */
const REF_TYPES = Object.freeze({ SERP: 'serp_snapshot', GSC: 'gsc_snapshot', BLOG: 'blog' });

/**
 * Which Blog this recommendation/action is actually about, if any.
 *
 * Prefers the action's own `result_summary.blog_id` (automated actions only
 * — server-verified, exactly which blog actionExecutors.js actually
 * mutated) over the recommendation's `target_ref.blog_id` (LLM-supplied,
 * best-effort, the only option manual actions ever have) — same
 * "server-computed evidence over LLM-claimed evidence" preference already
 * established by actionExecutors.js's own result_summary contract.
 */
function resolveTargetBlogId(action, recommendation) {
  const fromResult = action?.result_summary?.blog_id;
  if (Number.isFinite(Number(fromResult))) return Number(fromResult);
  const fromTargetRef = recommendation?.target_ref?.blog_id;
  if (Number.isFinite(Number(fromTargetRef))) return Number(fromTargetRef);
  return null;
}

/** Same existing target_ref shape used everywhere else (recommendations.js's TARGET_REF_KEYS) — no new targeting model. */
function resolveTargetKeyword(recommendation) {
  const raw = recommendation?.target_ref?.keyword;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function resolveTargetPageUrl(recommendation) {
  const raw = recommendation?.target_ref?.page_url;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

/**
 * Blog score baseline — always-available, zero external dependency (a
 * direct read of the row actionExecutors.js may have just mutated), so this
 * is attempted independently of whether SERP/GSC are even configured.
 * Reuses the Blog model's own already-computed score columns
 * (seo_score/aeo_score/geo_score/word_count) — no duplicate scoring system.
 * @private
 */
async function captureBlogScoreBaseline(blogId) {
  if (blogId === null) return null;
  try {
    const { Blog } = require('../../models');
    const blog = await Blog.findByPk(blogId);
    if (!blog) return null;

    const metrics = [];
    if (Number.isFinite(blog.seo_score)) metrics.push({ metric: 'seo_score', value: blog.seo_score });
    if (Number.isFinite(blog.aeo_score)) metrics.push({ metric: 'aeo_score', value: blog.aeo_score });
    if (Number.isFinite(blog.geo_score)) metrics.push({ metric: 'geo_score', value: blog.geo_score });
    if (Number.isFinite(blog.word_count)) metrics.push({ metric: 'word_count', value: blog.word_count });
    if (metrics.length === 0) return null; // a draft with no scores yet — nothing deterministic to record

    return { ref: { type: REF_TYPES.BLOG, id: blog.id }, metrics };
  } catch (err) {
    logger.warn('Outcome baseline: blog score read failed — skipped, not fabricated.', {
      blogId,
      message: err.message,
    });
    return null;
  }
}

/**
 * SERP baseline — reuses the existing checkRank() exactly as every other
 * caller does (same INTERNAL_HOSTS[0] "our domain" constant every existing
 * SERP caller already uses; never a second hardcoded domain literal). Only
 * attempted when SERP is enabled and a keyword is resolvable from the
 * recommendation's own target_ref.
 * @private
 */
async function captureSerpBaseline({ keyword, blogId }) {
  const serp = require('../serp');
  if (!serp.isEnabled() || !keyword) return null;

  try {
    const { INTERNAL_HOSTS } = require('../seoScore');
    const result = await serp.checkRank({
      keyword,
      domain: INTERNAL_HOSTS[0],
      blogId: blogId === null ? undefined : blogId,
    });

    // checkRank() already persisted a snapshot internally (best-effort, via
    // saveSerpSnapshot) but does not hand back its id. Looked up read-only
    // here — never a second SerpAPI call — by the exact identity checkRank
    // just wrote under. Synchronous within this same request, so this is
    // deterministically the row checkRank just created or dedup-reused.
    const { SerpSnapshot } = require('../../models');
    const snapshot = await SerpSnapshot.findOne({
      where: { normalized_keyword: serp.normalizeKeyword(keyword) },
      order: [['created_at', 'DESC']],
    });
    if (!snapshot) {
      // checkRank's own internal snapshot persistence is itself best-effort
      // (wrapped in try/catch there) — if it failed, there is nothing to
      // point at. The rank number itself was real, but with no evidence_ref
      // to anchor it to, recording it would violate "pointers, not
      // fabricated data" — so this source is skipped, not faked.
      logger.warn('Outcome baseline: SERP rank was checked but no snapshot was found to reference — skipped.', {
        keyword,
      });
      return null;
    }

    return {
      ref: { type: REF_TYPES.SERP, id: snapshot.id },
      metrics: [{ metric: 'serp_position', value: result.position }],
    };
  } catch (err) {
    logger.warn('Outcome baseline: SERP capture failed — skipped, not fabricated.', {
      keyword,
      message: err.message,
    });
    return null;
  }
}

/**
 * GSC baseline — reuses the existing fetchSearchAnalytics() exactly as the
 * live-verified GSC integration already does. Only attempted when GSC is
 * enabled and a page/keyword target is resolvable. GSC's own ~2-day
 * processing lag is already handled by the existing gsc.lastNDays() helper
 * this reuses — no separate lag-handling logic invented here.
 * @private
 */
async function captureGscBaseline({ pageUrl, keyword }) {
  const gsc = require('../gsc');
  if (!gsc.isEnabled() || (!pageUrl && !keyword)) return null;

  try {
    const { start, end } = gsc.lastNDays(GSC_BASELINE_WINDOW_DAYS);
    const snapshot = await gsc.fetchSearchAnalytics({ startDate: start, endDate: end, dimensions: ['query', 'page'] });

    const allRows = snapshot.rows || [];
    let rows = allRows;
    if (pageUrl) {
      rows = allRows.filter((r) => r.page && r.page.toLowerCase() === pageUrl.toLowerCase());
    } else if (keyword) {
      rows = allRows.filter((r) => r.query && r.query.toLowerCase() === keyword.toLowerCase());
    }

    if (rows.length === 0) {
      // A real snapshot was fetched and persisted, but nothing in it matches
      // this recommendation's target — GSC's processing lag or simply no
      // traffic yet for this page/keyword. Recorded as unavailable, not
      // fabricated as zero.
      logger.info('Outcome baseline: GSC snapshot fetched but no rows matched the target page/keyword.', {
        pageUrl,
        keyword,
        snapshotId: snapshot.id,
      });
      return null;
    }

    const { weightedAveragePosition } = require('./tools/seoAnalystAgentTools');
    const clicks = rows.reduce((sum, r) => sum + r.clicks, 0);
    const impressions = rows.reduce((sum, r) => sum + r.impressions, 0);
    const avgPosition = weightedAveragePosition(rows);

    const metrics = [
      { metric: 'gsc_clicks', value: clicks },
      { metric: 'gsc_impressions', value: impressions },
      { metric: 'gsc_ctr', value: impressions > 0 ? clicks / impressions : 0 },
    ];
    if (avgPosition !== null) metrics.push({ metric: 'gsc_position', value: avgPosition });

    return { ref: { type: REF_TYPES.GSC, id: snapshot.id }, metrics };
  } catch (err) {
    logger.warn('Outcome baseline: GSC capture failed — skipped, not fabricated.', {
      pageUrl,
      keyword,
      message: err.message,
    });
    return null;
  }
}

/**
 * Captures a baseline for one already-completed action, if any evidence
 * source actually resolves. Idempotent: checks for an existing outcome row
 * for this action_id BEFORE touching any external API (so a retried/
 * duplicate completion call never re-fetches SERP/GSC data it already
 * captured), and the table's own action_id UNIQUE constraint (P2-A) is the
 * backstop if two calls ever race past that check.
 *
 * @param {object} input
 * @param {import('../../models').AgentRecommendation} input.recommendation
 * @param {import('../../models').RecommendationAction} input.action Must already be status:'completed'.
 * @returns {Promise<import('../../models').RecommendationOutcome|null>} The
 *   outcome row (existing or newly created), or null if nothing was
 *   resolvable / capture failed.
 */
async function captureBaseline({ recommendation, action } = {}) {
  if (!recommendation || !action) return null;

  const { RecommendationOutcome } = require('../../models');

  // Idempotency, checked first, before any external call — see the header
  // comment. Same narrow, accepted check-then-create race as
  // createAction's own pending-action guard (single-org, admin-only,
  // low-concurrency tool); the UNIQUE constraint below is the real backstop.
  const existing = await RecommendationOutcome.findOne({ where: { action_id: action.id } });
  if (existing) return existing;

  const blogId = resolveTargetBlogId(action, recommendation);
  const keyword = resolveTargetKeyword(recommendation);
  const pageUrl = resolveTargetPageUrl(recommendation);

  const [blogResult, serpResult, gscResult] = await Promise.all([
    captureBlogScoreBaseline(blogId),
    captureSerpBaseline({ keyword, blogId }),
    captureGscBaseline({ pageUrl, keyword }),
  ]);

  const resolved = [blogResult, serpResult, gscResult].filter(Boolean);
  if (resolved.length === 0) {
    // Not every recommendation is metric-observable (no blog target, SERP/GSC
    // disabled, or a keyword/page that genuinely has no data yet) — a
    // no-op, not an error, and no partial/fabricated row is created.
    logger.info('Outcome baseline: no evidence source resolved for this recommendation — no outcome row created.', {
      recommendationId: recommendation.id,
      actionId: action.id,
    });
    return null;
  }

  const evidenceRefs = resolved.map((r) => r.ref);
  const metricSnapshot = resolved.flatMap((r) => r.metrics);

  const windowDays =
    Number.isInteger(recommendation.observation_window_days) && recommendation.observation_window_days > 0
      ? recommendation.observation_window_days
      : DEFAULT_OBSERVATION_WINDOW_DAYS;

  const baselineCapturedAt = new Date();
  const dueAt = new Date(baselineCapturedAt.getTime() + windowDays * 24 * 60 * 60 * 1000);

  try {
    return await RecommendationOutcome.create({
      recommendation_id: recommendation.id,
      action_id: action.id,
      baseline_captured_at: baselineCapturedAt,
      baseline_evidence_refs: evidenceRefs,
      baseline_metric_snapshot: metricSnapshot,
      observation_window_days: windowDays,
      due_at: dueAt,
      status: 'pending',
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      // Lost a genuine race to a concurrent call — the other side already
      // created the row; return it rather than treating this as a failure.
      return RecommendationOutcome.findOne({ where: { action_id: action.id } });
    }
    logger.warn('Outcome baseline: persistence failed — the action completion itself is unaffected.', {
      actionId: action.id,
      message: err.message,
    });
    return null;
  }
}

/**
 * The one entry point recommendationActions.js actually calls — loads the
 * parent recommendation and delegates to captureBaseline(), catching
 * everything so a baseline-capture bug can never affect completeAction's/
 * executeAction's own return value or the action's own terminal status.
 *
 * @param {import('../../models').RecommendationAction} action Must already be status:'completed'.
 * @returns {Promise<import('../../models').RecommendationOutcome|null>}
 */
async function captureBaselineForCompletedAction(action) {
  if (!action || action.status !== 'completed') return null;

  try {
    const { AgentRecommendation } = require('../../models');
    const recommendation = await AgentRecommendation.findByPk(action.recommendation_id);
    if (!recommendation) return null;
    return await captureBaseline({ recommendation, action });
  } catch (err) {
    logger.warn('Outcome baseline capture failed after action completion — action status is unaffected.', {
      actionId: action.id,
      message: err.message,
    });
    return null;
  }
}

/**
 * P2-D: the one read this file exposes for the API layer — a plain lookup,
 * no computation, no mutation. Returns `null` (never throws) when no
 * baseline was ever captured for this action (e.g. nothing was
 * metric-observable, or the action isn't completed) — the controller turns
 * that into a 404, never a fabricated empty outcome.
 *
 * @param {number|string} actionId
 * @returns {Promise<import('../../models').RecommendationOutcome|null>}
 */
async function getOutcomeForAction(actionId) {
  const { RecommendationOutcome } = require('../../models');
  return RecommendationOutcome.findOne({ where: { action_id: actionId } });
}

module.exports = {
  captureBaseline,
  captureBaselineForCompletedAction,
  getOutcomeForAction,
  // P2-C reuses these four directly for its "fresh" evidence fetch — each
  // one already just reads CURRENT state (a live Blog row / a live
  // checkRank call / a live fetchSearchAnalytics call); nothing about them
  // is baseline-specific. Reusing them (rather than P2-C growing its own
  // second copy of "how to read a blog score / SERP position / GSC row") is
  // exactly the "no duplicate metric systems" requirement — one capture
  // implementation, called at two different points in the lifecycle.
  captureBlogScoreBaseline,
  captureSerpBaseline,
  captureGscBaseline,
  resolveTargetBlogId,
  resolveTargetKeyword,
  resolveTargetPageUrl,
  DEFAULT_OBSERVATION_WINDOW_DAYS,
  GSC_BASELINE_WINDOW_DAYS,
  REF_TYPES,
};
