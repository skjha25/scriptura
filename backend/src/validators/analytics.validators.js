'use strict';

/** Zod schemas for the analytics endpoints. */

const { z } = require('zod');

const overviewQuerySchema = z.object({
  /**
   * Months of history for the time-series charts. Bounded at 36 because the
   * aggregation walks every row in JS (see analyticsService's header note) and an
   * unbounded window would let a client ask for an arbitrarily expensive shape.
   */
  months: z.coerce.number().int().min(1).max(36).optional().default(7),
});

module.exports = { overviewQuerySchema };
