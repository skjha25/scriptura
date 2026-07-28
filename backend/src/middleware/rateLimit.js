'use strict';

/**
 * Rate limiters.
 *
 * Three tiers, because the endpoints have very different costs:
 *   - global      : broad abuse guard on the whole API
 *   - auth        : tight, to blunt credential stuffing on /auth/login
 *   - generation  : tightest, because each call spends real money at Anthropic
 *                   or OpenAI and takes tens of seconds
 *
 * Keying: authenticated requests are keyed by user id, so one team member
 * hammering generation cannot exhaust the shared office-IP budget for everyone
 * else. Unauthenticated requests fall back to IP.
 *
 * Storage is the library's default in-memory store. That is correct for a
 * single-process internal tool; running multiple instances would need a shared
 * store (Redis), noted in ARCHITECTURE.md.
 */

const rateLimit = require('express-rate-limit');
const config = require('../config');
const ApiError = require('../utils/ApiError');

/** Prefer the authenticated user over the IP so limits are per-person. */
function keyByUserOrIp(req) {
  return req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`;
}

function makeLimiter({ windowMs, max, code, message, skipInTest = true }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: keyByUserOrIp,
    // Integration tests fire many requests in a tight loop; leaving limits on
    // would make them flaky and assert nothing useful. The dedicated
    // rate-limit test builds its own limiter with a tiny budget instead.
    skip: () => skipInTest && config.isTest,
    handler: (req, res, next, options) => {
      next(
        new ApiError(429, message, {
          code,
          details: {
            retryAfterSeconds: Math.ceil(options.windowMs / 1000),
            limit: options.limit,
          },
        })
      );
    },
  });
}

/** Applied to the whole /api/v1 surface. */
const globalLimiter = makeLimiter({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  code: 'RATE_LIMITED',
  message: 'Too many requests. Please slow down and try again shortly.',
});

/** Applied to login and refresh. */
const authLimiter = makeLimiter({
  windowMs: config.rateLimit.authWindowMs,
  max: config.rateLimit.authMax,
  code: 'AUTH_RATE_LIMITED',
  message: 'Too many authentication attempts. Please wait before trying again.',
});

/**
 * Applied to every endpoint that calls a paid AI provider: title/outline/article
 * generation, brand-voice analysis, image generation, SERP lookups.
 */
const generationLimiter = makeLimiter({
  windowMs: config.rateLimit.generationWindowMs,
  max: config.rateLimit.generationMax,
  code: 'GENERATION_RATE_LIMITED',
  message:
    'Generation rate limit reached. This protects the shared AI provider budget — ' +
    'please wait before starting more generations.',
});

module.exports = {
  globalLimiter,
  authLimiter,
  generationLimiter,
  makeLimiter,
  keyByUserOrIp,
};
