'use strict';

/**
 * Terminal error middleware plus the 404 fallback.
 *
 * Two rules drive the design:
 *   1. Never leak internals. Only errors explicitly marked `expose` (i.e.
 *      ApiError, or a translated known library error) have their message sent
 *      to the client. Everything else becomes a flat 500.
 *   2. Translate, don't pass through. Sequelize, JWT, Multer and body-parser
 *      all throw their own shapes; each is mapped to the same response envelope
 *      so the frontend has exactly one error contract to handle.
 */

const { ValidationError, UniqueConstraintError, ForeignKeyConstraintError, DatabaseError, ConnectionError } =
  require('sequelize');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const config = require('../config');

/** Mounted after all routes: anything reaching it matched no route. */
function notFoundHandler(req, res, next) {
  next(
    ApiError.notFound(`No route matches ${req.method} ${req.originalUrl}`, {
      code: 'ROUTE_NOT_FOUND',
    })
  );
}

/**
 * Converts a known library error into an ApiError. Returns null when the error
 * is not recognised, which the caller treats as a 500.
 */
function translate(err) {
  if (err instanceof ApiError) return err;

  // --- Sequelize -------------------------------------------------------------
  if (err instanceof UniqueConstraintError) {
    const fields = Object.keys(err.fields || {});
    return ApiError.conflict(
      fields.length
        ? `A record with that ${fields.join(', ')} already exists.`
        : 'A record with those values already exists.',
      { code: 'DUPLICATE_RESOURCE', details: { fields }, cause: err }
    );
  }

  if (err instanceof ValidationError) {
    // Model-level validation (allowNull, isEmail, custom validators). Shaped to
    // match the Zod validator output so clients parse field errors one way.
    return ApiError.unprocessable('The submitted data failed validation.', {
      code: 'VALIDATION_ERROR',
      details: {
        fieldErrors: (err.errors || []).reduce((acc, e) => {
          const key = e.path || '_';
          acc[key] = acc[key] || [];
          acc[key].push(e.message);
          return acc;
        }, {}),
      },
      cause: err,
    });
  }

  if (err instanceof ForeignKeyConstraintError) {
    return ApiError.conflict('That operation would break a reference to another record.', {
      code: 'FOREIGN_KEY_CONSTRAINT',
      cause: err,
    });
  }

  if (err instanceof ConnectionError) {
    // The database is down or unreachable — a real outage, not a client fault.
    return new ApiError(503, 'The database is currently unavailable. Please retry shortly.', {
      code: 'DATABASE_UNAVAILABLE',
      cause: err,
    });
  }

  if (err instanceof DatabaseError) {
    // A malformed query is our bug, so do not echo the SQL back to the client.
    return new ApiError(500, 'A database error occurred.', {
      code: 'DATABASE_ERROR',
      cause: err,
    });
  }

  // --- JWT -------------------------------------------------------------------
  if (err.name === 'TokenExpiredError') {
    return ApiError.unauthorized('Your session has expired. Please refresh or sign in again.', {
      code: 'TOKEN_EXPIRED',
      cause: err,
    });
  }
  if (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError') {
    return ApiError.unauthorized('Invalid authentication token.', {
      code: 'TOKEN_INVALID',
      cause: err,
    });
  }

  // --- Multer (uploads) ------------------------------------------------------
  if (err.name === 'MulterError') {
    const messages = {
      LIMIT_FILE_SIZE: 'The uploaded file is larger than the allowed limit.',
      LIMIT_FILE_COUNT: 'Too many files were uploaded.',
      LIMIT_UNEXPECTED_FILE: `Unexpected file field "${err.field}".`,
    };
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return new ApiError(status, messages[err.code] || 'File upload failed.', {
      code: `UPLOAD_${err.code}`,
      cause: err,
    });
  }

  // --- body-parser -----------------------------------------------------------
  if (err.type === 'entity.parse.failed') {
    return ApiError.badRequest('Request body is not valid JSON.', {
      code: 'MALFORMED_JSON',
      cause: err,
    });
  }
  if (err.type === 'entity.too.large') {
    return new ApiError(413, 'Request body is too large.', {
      code: 'PAYLOAD_TOO_LARGE',
      cause: err,
    });
  }

  return null;
}

/* eslint-disable no-unused-vars -- Express identifies error middleware by arity (4). */
function errorHandler(err, req, res, next) {
  const apiError =
    translate(err) ||
    new ApiError(500, 'An unexpected error occurred.', { code: 'INTERNAL_ERROR', cause: err });

  // 5xx means we broke something: log at error with the full stack. 4xx is
  // routine client behaviour, so log at debug to avoid drowning real problems.
  const logMeta = {
    method: req.method,
    url: req.originalUrl,
    userId: req.user?.id,
    code: apiError.code,
    cause: apiError.cause?.stack || apiError.cause?.message,
  };
  if (apiError.statusCode >= 500) {
    logger.error(`${apiError.statusCode} ${apiError.message}`, {
      ...logMeta,
      stack: err.stack,
    });
  } else {
    logger.debug(`${apiError.statusCode} ${apiError.message}`, logMeta);
  }

  // Headers already flushed (e.g. mid-stream failure) — the only correct move
  // is to abort the connection rather than append a second body.
  if (res.headersSent) {
    res.destroy();
    return;
  }

  const body = apiError.toJSON();
  // Stacks are a debugging aid for local work only; never in production.
  if (config.isDevelopment && apiError.statusCode >= 500) {
    body.error.stack = err.stack;
  }

  res.status(apiError.statusCode).json(body);
}
/* eslint-enable no-unused-vars */

module.exports = { errorHandler, notFoundHandler, translate };
