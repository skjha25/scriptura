'use strict';

/**
 * The one error type route handlers and services throw.
 *
 * Carrying the HTTP status and a stable machine-readable `code` on the error
 * means the error handler never has to guess a status from a message string,
 * and the frontend can branch on `code` without parsing prose.
 *
 * `expose` marks an error as safe to show verbatim to the client. Anything
 * without it (a stray TypeError, a driver failure) is reported as a generic
 * 500 so internal details and stack traces never reach a response body.
 */
class ApiError extends Error {
  /**
   * @param {number} statusCode HTTP status to respond with.
   * @param {string} message Human-readable message, safe for the client.
   * @param {object} [options]
   * @param {string} [options.code] Stable machine-readable code, e.g. 'NOT_FOUND'.
   * @param {*} [options.details] Extra structured context (field errors, etc).
   * @param {Error} [options.cause] Underlying error, kept for logs only.
   */
  constructor(statusCode, message, { code, details, cause } = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code || ApiError.defaultCodeFor(statusCode);
    this.details = details;
    this.expose = true;
    if (cause) this.cause = cause;
    Error.captureStackTrace(this, ApiError);
  }

  static defaultCodeFor(statusCode) {
    const map = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      413: 'PAYLOAD_TOO_LARGE',
      415: 'UNSUPPORTED_MEDIA_TYPE',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'RATE_LIMITED',
      500: 'INTERNAL_ERROR',
      502: 'UPSTREAM_ERROR',
      503: 'SERVICE_UNAVAILABLE',
      504: 'UPSTREAM_TIMEOUT',
    };
    return map[statusCode] || 'ERROR';
  }

  static badRequest(message, options) {
    return new ApiError(400, message, options);
  }

  static unauthorized(message = 'Authentication required.', options) {
    return new ApiError(401, message, options);
  }

  static forbidden(message = 'You do not have permission to do that.', options) {
    return new ApiError(403, message, options);
  }

  static notFound(message = 'Resource not found.', options) {
    return new ApiError(404, message, options);
  }

  static conflict(message, options) {
    return new ApiError(409, message, options);
  }

  static unprocessable(message, options) {
    return new ApiError(422, message, options);
  }

  /** An upstream provider (Anthropic, OpenAI, SerpAPI) failed or timed out. */
  static upstream(message, options) {
    return new ApiError(502, message, { code: 'UPSTREAM_ERROR', ...options });
  }

  /** A feature is switched off by configuration, e.g. SERPAPI_ENABLED=false. */
  static featureDisabled(message, options) {
    return new ApiError(503, message, { code: 'FEATURE_DISABLED', ...options });
  }

  /** Serialisable shape used by the error handler. */
  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

module.exports = ApiError;
