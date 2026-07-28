'use strict';

/**
 * Generation endpoints: titles, outline, article, status.
 *
 * The handlers are thin on purpose. Validation happens in middleware, the rules
 * live in services/generation.js, and what is left here is HTTP shape: status
 * codes, response envelopes, and reading the id out of whichever param name the
 * route used.
 *
 * Status codes worth noting:
 *   - 200 for titles and outline: the work is done by the time we respond.
 *   - 202 for an article: the row is claimed and the run continues after the
 *     response. Anything other than 202 would tell the client the article
 *     exists, which it does not yet.
 */

const asyncHandler = require('../utils/asyncHandler');
const generation = require('../services/generation');
const { GENERATION_IN_FLIGHT } = require('../constants');

/**
 * POST /generate/title
 * Suggests SEO titles, each with its own scored breakdown.
 */
const generateTitle = asyncHandler(async (req, res) => {
  const result = await generation.generateTitles(req.body);
  res.json(result);
});

/**
 * POST /generate/outline
 * Generates a section outline, persisting it when `blog_id` is supplied.
 */
const generateOutline = asyncHandler(async (req, res) => {
  const result = await generation.generateOutline(req.body);
  res.json(result);
});

/**
 * POST /generate/article
 *
 * Accepted, not completed. The response carries the poll target so the client
 * does not have to construct it, and `Location` points at the same place for any
 * consumer that follows the header instead of the body.
 */
const generateArticle = asyncHandler(async (req, res) => {
  const { blog_id: blogId, config } = req.body;

  const result = await generation.startGeneration({
    blogId,
    config,
    user: req.user,
  });

  const statusPath = `/generate/status/${result.blog_id}`;
  res.status(202)
    .location(statusPath)
    .json({
      ...result,
      poll: statusPath,
      message:
        'Generation started. Poll the status endpoint until generation_status is "generated" or "failed".',
    });
});

/**
 * Bare status handler, mounted twice.
 *
 * `GET /generate/status/:blogId` lives in this route group;
 * `GET /blogs/:id/generation-status` is mounted by the blogs workstream against
 * the same function. Reading `req.params.id ?? req.params.blogId` is what lets
 * one implementation serve both without either side knowing about the other.
 *
 * @type {import('express').RequestHandler}
 */
const generationStatusHandler = asyncHandler(async (req, res) => {
  const blogId = req.params.id ?? req.params.blogId;
  const status = await generation.getGenerationStatus(blogId);

  // A short no-store is the honest cache header for a value the client is
  // polling: any caching at all would make the poll return a stale state and the
  // wizard would appear to hang.
  res.set('Cache-Control', 'no-store');
  res.json(status);
});

/**
 * GET /generate/status/:blogId
 * Alias kept for readability at the route definition.
 */
const getStatus = generationStatusHandler;

/**
 * POST /generate/reap-stale
 *
 * Admin-only recovery for rows orphaned in `generating` by a restart. Exposed as
 * an endpoint rather than only as a boot-time call so the team can unstick a blog
 * without a deploy — the in-process pipeline makes that a real occasional need.
 */
const reapStale = asyncHandler(async (req, res) => {
  const olderThanMs = req.body?.older_than_ms;
  const result = await generation.reapStaleGenerations(
    olderThanMs === undefined ? {} : { olderThanMs: Number(olderThanMs) }
  );
  res.json({ ...result, in_flight_statuses: [...GENERATION_IN_FLIGHT] });
});

module.exports = {
  generateTitle,
  generateOutline,
  generateArticle,
  getStatus,
  generationStatusHandler,
  reapStale,
};
