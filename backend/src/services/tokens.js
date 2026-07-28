'use strict';

/**
 * JWT issuing and verification.
 *
 * Design notes:
 *
 * - Two secrets, two token types. A refresh token must never be accepted where
 *   an access token is expected, so they are signed with different secrets AND
 *   carry a `type` claim that is checked on verify. Either mechanism alone would
 *   do; both together mean a mistake in one place is not exploitable.
 *
 * - Refresh tokens embed the user's `token_version`. Logout increments that
 *   column, which invalidates every refresh token issued before it without
 *   needing a server-side denylist. This is what makes logout actually revoke
 *   access in a stateless setup.
 *
 * - Access tokens are short-lived (15m default) and are NOT version-checked on
 *   every request; doing so would mean a database read per request and defeat
 *   the point of a stateless token. The consequence — an access token stays
 *   valid for up to its TTL after logout — is the standard trade-off, and the
 *   TTL is the bound on it.
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const ApiError = require('../utils/ApiError');

const TOKEN_TYPE = Object.freeze({
  ACCESS: 'access',
  REFRESH: 'refresh',
});

/**
 * Mints an access token.
 * @param {{id: number|string, email: string, role: string}} user
 * @returns {string}
 */
function signAccessToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      role: user.role,
      type: TOKEN_TYPE.ACCESS,
    },
    config.jwt.accessSecret,
    {
      expiresIn: config.jwt.accessTtl,
      issuer: config.jwt.issuer,
    }
  );
}

/**
 * Mints a refresh token bound to the user's current token_version.
 * @param {{id: number|string, token_version: number}} user
 * @returns {string}
 */
function signRefreshToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      tv: user.token_version ?? 0,
      type: TOKEN_TYPE.REFRESH,
    },
    config.jwt.refreshSecret,
    {
      expiresIn: config.jwt.refreshTtl,
      issuer: config.jwt.issuer,
    }
  );
}

/** Issues both tokens at once, for login and refresh responses. */
function issueTokenPair(user) {
  return {
    access_token: signAccessToken(user),
    refresh_token: signRefreshToken(user),
    token_type: 'Bearer',
    expires_in: config.jwt.accessTtl,
  };
}

/**
 * Verifies an access token.
 *
 * Throws ApiError (401) rather than letting the raw jsonwebtoken error escape,
 * so callers get a consistent shape. TokenExpiredError is distinguished from a
 * malformed token because the frontend reacts differently: expiry triggers a
 * silent refresh, invalidity forces a re-login.
 *
 * @param {string} token
 * @returns {{id: string, email: string, role: string}}
 */
function verifyAccessToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwt.accessSecret, { issuer: config.jwt.issuer });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('Your session has expired.', { code: 'TOKEN_EXPIRED', cause: err });
    }
    throw ApiError.unauthorized('Invalid authentication token.', {
      code: 'TOKEN_INVALID',
      cause: err,
    });
  }

  // A refresh token is signed with a different secret so it cannot verify here,
  // but the explicit check documents the intent and guards against a future
  // refactor that accidentally unifies the secrets.
  if (payload.type !== TOKEN_TYPE.ACCESS) {
    throw ApiError.unauthorized('Expected an access token.', { code: 'TOKEN_WRONG_TYPE' });
  }

  return { id: payload.sub, email: payload.email, role: payload.role };
}

/**
 * Verifies a refresh token. Returns the claims; the caller is responsible for
 * loading the user and comparing `tv` against the stored token_version.
 * @param {string} token
 * @returns {{id: string, tokenVersion: number}}
 */
function verifyRefreshToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwt.refreshSecret, { issuer: config.jwt.issuer });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('Your session has expired. Please sign in again.', {
        code: 'REFRESH_TOKEN_EXPIRED',
        cause: err,
      });
    }
    throw ApiError.unauthorized('Invalid refresh token.', {
      code: 'REFRESH_TOKEN_INVALID',
      cause: err,
    });
  }

  if (payload.type !== TOKEN_TYPE.REFRESH) {
    throw ApiError.unauthorized('Expected a refresh token.', { code: 'TOKEN_WRONG_TYPE' });
  }

  return { id: payload.sub, tokenVersion: payload.tv ?? 0 };
}

/**
 * Pulls a bearer token out of the Authorization header.
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractBearerToken(req) {
  const header = req.headers?.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

module.exports = {
  TOKEN_TYPE,
  signAccessToken,
  signRefreshToken,
  issueTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  extractBearerToken,
};
