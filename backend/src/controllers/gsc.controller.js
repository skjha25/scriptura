'use strict';

/**
 * POST /gsc/sync — manual, on-demand trigger.
 *
 * The only other path into services/gsc.js's fetchSearchAnalytics() is
 * captureGscBaseline() (services/agents/outcomeMeasurement.js), itself only
 * reachable by completing an SEO Analyst recommendation. That makes GSC data
 * invisible on a fresh deployment until someone completes one — this endpoint
 * gives an admin a direct way to fetch+store a snapshot and confirm the
 * integration (credentials, property access) actually works, independent of
 * that lifecycle.
 */

const asyncHandler = require('../utils/asyncHandler');
const gsc = require('../services/gsc');

const sync = asyncHandler(async (req, res) => {
  const { start, end } = gsc.lastNDays(req.body.days || 7);
  const snapshot = await gsc.fetchSearchAnalytics({
    siteUrl: req.body.site_url,
    startDate: start,
    endDate: end,
  });

  const totals = snapshot.rows.reduce(
    (acc, row) => ({
      clicks: acc.clicks + row.clicks,
      impressions: acc.impressions + row.impressions,
    }),
    { clicks: 0, impressions: 0 }
  );

  res.json({
    site_url: snapshot.site_url,
    date_range_start: snapshot.date_range_start,
    date_range_end: snapshot.date_range_end,
    fetched_at: snapshot.fetched_at,
    row_count: snapshot.rows.length,
    totals,
  });
});

module.exports = { sync };
