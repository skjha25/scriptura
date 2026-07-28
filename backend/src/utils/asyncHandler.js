'use strict';

/**
 * Wraps an async route handler so a rejected promise reaches Express's error
 * middleware instead of becoming an unhandled rejection and hanging the request.
 *
 * Express 4 does not await handlers, so this wrapper is required on every async
 * handler. Express 5 does, at which point this can be deleted.
 *
 *   router.get('/', asyncHandler(async (req, res) => { ... }));
 */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
