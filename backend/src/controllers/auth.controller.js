'use strict';

/**
 * Auth handlers: sign in, refresh, sign out, and "who am I".
 *
 * There is no registration endpoint. Scriptura is an internal tool for a known
 * team; accounts are created by the seeder in development and by an admin
 * out-of-band in production. A self-serve signup would be a way in for anyone
 * who found the URL.
 */

const bcrypt = require('bcryptjs');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { User } = require('../models');
const { issueTokenPair, verifyRefreshToken } = require('../services/tokens');

/**
 * A valid bcrypt hash of a value nobody will submit, used to equalise response
 * time between "no such user" and "wrong password".
 *
 * Without it, a missing account returns in microseconds while a wrong password
 * costs a full bcrypt comparison (~250ms at 12 rounds) — a timing difference
 * large enough to enumerate valid addresses over the network.
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.RiOaJ7Nn0DAOgvXQ0hVQVOSXbTVQKKO';

/**
 * POST /auth/login
 *
 * Returns an access/refresh pair plus the user profile, so the frontend does not
 * need a second round trip to render the shell.
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // `withPassword` opts out of the model's defaultScope, which excludes the hash.
  const user = await User.scope('withPassword').findOne({ where: { email } });

  // A wrong email and a wrong password return the identical response. Anything
  // else turns this endpoint into an account-enumeration oracle.
  const passwordMatches = user
    ? await user.verifyPassword(password)
    : // Burn comparable time on a missing account. The result is discarded; only
      // the elapsed time matters.
      await bcrypt.compare(password, DUMMY_HASH).catch(() => false);

  if (!user || !passwordMatches) {
    logger.debug('Failed login attempt', { email, reason: user ? 'bad_password' : 'no_such_user' });
    throw ApiError.unauthorized('Incorrect email or password.', {
      code: 'INVALID_CREDENTIALS',
    });
  }

  if (!user.is_active) {
    // Distinguished from bad credentials on purpose: the credentials were
    // correct, so telling the user their account is disabled is actionable
    // rather than a disclosure.
    throw ApiError.forbidden('Your account has been deactivated. Contact an administrator.', {
      code: 'USER_INACTIVE',
    });
  }

  const tokens = issueTokenPair(user);

  // Recorded for the admin view. Deliberately not awaited into the critical
  // path's failure modes — a write failure here must not block a valid login.
  user.last_login_at = new Date();
  await user.save({ fields: ['last_login_at', 'updated_at'] }).catch((err) => {
    logger.warn('Could not record last_login_at', err);
  });

  logger.info('User signed in', { userId: Number(user.id), email: user.email });

  res.json({ ...tokens, user: user.toSafeJSON() });
});

/**
 * POST /auth/refresh
 *
 * Exchanges a refresh token for a new pair. The token's embedded
 * `token_version` must still match the user's — that comparison is what makes
 * logout able to revoke a refresh token without a server-side denylist.
 */
const refresh = asyncHandler(async (req, res) => {
  const { refresh_token: refreshToken } = req.body;

  const claims = verifyRefreshToken(refreshToken);
  const user = await User.findByPk(claims.id);

  if (!user) {
    throw ApiError.unauthorized('Your account no longer exists.', { code: 'USER_NOT_FOUND' });
  }
  if (!user.is_active) {
    throw ApiError.forbidden('Your account has been deactivated.', { code: 'USER_INACTIVE' });
  }
  if (claims.tokenVersion !== user.token_version) {
    // Signed out elsewhere, or the password was changed. The token is
    // cryptographically valid but semantically stale.
    throw ApiError.unauthorized('This session has been revoked. Please sign in again.', {
      code: 'REFRESH_TOKEN_REVOKED',
    });
  }

  // Rotate both tokens rather than only reissuing the access token: a refresh
  // token that is used once and replaced limits the window in which a captured
  // one is useful.
  const tokens = issueTokenPair(user);
  res.json({ ...tokens, user: user.toSafeJSON() });
});

/**
 * POST /auth/logout
 *
 * Increments `token_version`, invalidating every refresh token issued to this
 * user. Already-issued access tokens stay valid until they expire (15m by
 * default) — the standard trade-off for stateless access tokens, bounded by
 * their TTL. Checking the version on every request would mean a database read
 * per request and defeat the point.
 */
const logout = asyncHandler(async (req, res) => {
  const user = req.userRecord;

  await user.increment('token_version');

  logger.info('User signed out', { userId: Number(user.id) });

  res.json({
    message: 'Signed out. All refresh tokens for this account have been revoked.',
    access_token_valid_until_expiry: true,
  });
});

/**
 * GET /auth/me
 *
 * Lets the frontend validate a stored token and hydrate the current user on a
 * hard refresh without keeping profile data in localStorage.
 */
const me = asyncHandler(async (req, res) => {
  res.json({ user: req.userRecord.toSafeJSON() });
});

module.exports = { login, refresh, logout, me };
