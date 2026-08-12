'use strict';

/**
 * Tools available to the SEO Analyst Agent — read-only by design.
 *
 * There is no persisted analytics setting anywhere in the platform today (no
 * "default months window" or similar), so unlike every other agent in this
 * app, there is nothing here to propose+apply. Both tools just wrap the
 * existing analyticsService reads and hand the JSON straight to the model to
 * reason over.
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

module.exports = {
  TOOLS: [getAnalyticsOverview, getInFlightGenerations],
};
