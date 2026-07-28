'use strict';

/**
 * Authentication and authorisation middleware.
 *
 * There is no tenant scoping here, by design: Scriptura is a single-organisation
 * internal tool, so the only questions are "is this a signed-in Divinetalk team
 * member?" (requireAuth) and "are they an admin?" (requireRole).
 *
 * On success, `req.user` is set to:
 *   { id: number, name: string, email: string, role: 'admin'|'editor' }
 *
 * `id` is a Number, not the token's string `sub`, so downstream comparisons
 * against database ids do not need coercion.
 */

const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { verifyAccessToken, extractBearerToken } = require('../services/tokens');
const { USER_ROLES } = require('../constants');

/**
 * Requires a valid access token belonging to an active user.
 *
 * The user is loaded from the database on every request rather than trusted from
 * the token. That costs one indexed primary-key read, and buys the ability to
 * deactivate an account and have it take effect immediately instead of at token
 * expiry — worth it for an internal tool where revoking access needs to be
 * instant.
 */
const requireAuth = asyncHandler(async (req, res, next) => {
  const token = extractBearerToken(req);
  if (!token) {
    throw ApiError.unauthorized('Authentication required. Provide a Bearer access token.', {
      code: 'TOKEN_MISSING',
    });
  }

  const claims = verifyAccessToken(token);

  // Required lazily so this module can be imported by tests that have not yet
  // built a schema.
  const { User } = require('../models');
  const user = await User.findByPk(claims.id);

  if (!user) {
    // The token verified, so it was issued by us — the account has since been
    // removed. Treat as unauthenticated rather than as a server error.
    throw ApiError.unauthorized('Your account no longer exists.', { code: 'USER_NOT_FOUND' });
  }
  if (!user.is_active) {
    throw ApiError.forbidden('Your account has been deactivated.', { code: 'USER_INACTIVE' });
  }

  req.user = {
    id: Number(user.id),
    name: user.name,
    email: user.email,
    role: user.role,
  };
  // Kept for handlers that need model methods without a second query.
  req.userRecord = user;

  next();
});

/**
 * Restricts a route to the given roles. Must be mounted after requireAuth.
 *
 *   router.delete('/:id', requireAuth, requireRole('admin'), handler);
 *
 * @param {...string} allowedRoles
 */
function requireRole(...allowedRoles) {
  const allowed = new Set(allowedRoles.flat());

  return function checkRole(req, res, next) {
    if (!req.user) {
      // A programming error, not a client one: requireRole was mounted without
      // requireAuth in front of it. Fail loudly rather than silently allowing.
      return next(
        new ApiError(500, 'Authorisation check ran before authentication.', {
          code: 'MIDDLEWARE_ORDER_ERROR',
        })
      );
    }
    if (!allowed.has(req.user.role)) {
      return next(
        ApiError.forbidden(
          `This action requires the ${[...allowed].join(' or ')} role.`,
          { code: 'INSUFFICIENT_ROLE', details: { required: [...allowed], actual: req.user.role } }
        )
      );
    }
    return next();
  };
}

/** Convenience: admin-only. */
const requireAdmin = requireRole(USER_ROLES.ADMIN);

/**
 * Populates `req.user` when a valid token is present but never rejects.
 *
 * Used by endpoints that behave differently for a signed-in team member but
 * must still work anonymously (e.g. a public blog read that also serves the
 * editor's preview).
 */
const optionalAuth = asyncHandler(async (req, res, next) => {
  const token = extractBearerToken(req);
  if (!token) return next();

  try {
    const claims = verifyAccessToken(token);
    const { User } = require('../models');
    const user = await User.findByPk(claims.id);
    if (user && user.is_active) {
      req.user = {
        id: Number(user.id),
        name: user.name,
        email: user.email,
        role: user.role,
      };
      req.userRecord = user;
    }
  } catch {
    // An invalid token on an optional-auth route is treated as "anonymous",
    // not as an error — that is the whole point of the middleware.
  }

  return next();
});

module.exports = { requireAuth, requireRole, requireAdmin, optionalAuth };
