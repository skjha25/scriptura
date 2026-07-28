'use strict';

/**
 * Dashboard analytics handlers. All aggregation lives in
 * src/services/analyticsService.js.
 */

const asyncHandler = require('../utils/asyncHandler');
const { getOverview, getInFlightGenerations } = require('../services/analyticsService');

/**
 * GET /analytics/overview
 * Everything the dashboard renders, in one request — totals, the four charts,
 * top keywords, category breakdown, recent activity, and (only when SerpAPI is
 * configured) the ranking data.
 */
const overview = asyncHandler(async (req, res) => {
  const data = await getOverview({ months: req.query.months });
  res.json({ data });
});

/**
 * GET /analytics/in-flight
 * Blogs currently queued or generating. Polled by the dashboard so a running
 * generation shows live without refetching the whole list.
 */
const inFlight = asyncHandler(async (req, res) => {
  const data = await getInFlightGenerations();
  res.json({ data });
});

module.exports = { overview, inFlight };
