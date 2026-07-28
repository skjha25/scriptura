'use strict';

/**
 * SERP endpoints: rank checking and fact grounding.
 *
 * Both are feature-flagged. The 503 FEATURE_DISABLED comes from
 * services/serp.assertEnabled rather than being re-implemented here, so there is
 * exactly one definition of "SERP is off" and the message stays consistent
 * wherever it surfaces.
 */

const asyncHandler = require('../utils/asyncHandler');
const serp = require('../services/serp');

/**
 * POST /serp/check-rank
 *
 * A null `position` is a successful answer, not an error: "not in the top 100"
 * is exactly the information the dashboard needs, and a 404 would make the UI
 * show a failure state for a working lookup.
 */
const checkRank = asyncHandler(async (req, res) => {
  const result = await serp.checkRank({
    keyword: req.body.keyword,
    domain: req.body.domain,
    blogId: req.body.blog_id,
    country: req.body.country,
  });

  res.json({
    ...result,
    found: result.position !== null,
    depth_searched: serp.RANK_CHECK_DEPTH,
  });
});

/**
 * POST /serp/ground-facts
 *
 * Exposed separately from the generation pipeline so an editor can see what the
 * model will be given before spending a generation on it. The pipeline calls the
 * service directly rather than this endpoint.
 */
const groundFacts = asyncHandler(async (req, res) => {
  const result = await serp.groundFacts({
    topic: req.body.topic,
    keyword: req.body.keyword,
    country: req.body.country,
  });

  res.json({ ...result, source_count: result.sources.length });
});

module.exports = { checkRank, groundFacts };
