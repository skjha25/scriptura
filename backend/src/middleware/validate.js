'use strict';

/**
 * Zod request validation.
 *
 * Every endpoint that accepts input runs through this. Two properties matter:
 *
 *   1. It *replaces* req.body/query/params with the parsed result, so handlers
 *      receive coerced, defaulted, stripped data. Unknown keys are dropped by
 *      Zod objects, which is what stops clients from setting columns they have
 *      no business setting (e.g. total_views, seo_score) via mass assignment.
 *
 *   2. All three targets are validated in one pass and their errors merged, so
 *      a request with a bad query param *and* a bad body field reports both at
 *      once instead of making the client fix them one round-trip at a time.
 */

const { ZodError } = require('zod');
const ApiError = require('../utils/ApiError');

/**
 * Flattens a ZodError into `{ fieldName: [messages] }`, prefixing with the
 * request part so `body.title` and `query.title` stay distinguishable.
 */
function collectIssues(zodError, target, into) {
  for (const issue of zodError.issues) {
    const path = issue.path.length ? issue.path.join('.') : '_root';
    const key = `${target}.${path}`;
    into[key] = into[key] || [];
    into[key].push(issue.message);
  }
}

/**
 * @param {{body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny}} schemas
 */
function validate(schemas = {}) {
  const targets = ['params', 'query', 'body'].filter((t) => schemas[t]);

  return function validateRequest(req, res, next) {
    const fieldErrors = {};
    const parsed = {};

    for (const target of targets) {
      const result = schemas[target].safeParse(req[target]);
      if (result.success) {
        parsed[target] = result.data;
      } else {
        collectIssues(result.error, target, fieldErrors);
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      return next(
        ApiError.unprocessable('Request validation failed.', {
          code: 'VALIDATION_ERROR',
          details: { fieldErrors },
        })
      );
    }

    for (const target of targets) {
      // req.query is a getter-only property on Express 5 and a plain object on
      // 4; assigning via defineProperty works on both.
      Object.defineProperty(req, target, {
        value: parsed[target],
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }

    return next();
  };
}

/**
 * Validates a value outside the request cycle (services, job workers, tests)
 * and raises the same ApiError shape the middleware produces.
 */
function validateValue(schema, value, label = 'value') {
  try {
    return schema.parse(value);
  } catch (err) {
    if (err instanceof ZodError) {
      const fieldErrors = {};
      collectIssues(err, label, fieldErrors);
      throw ApiError.unprocessable(`${label} validation failed.`, {
        code: 'VALIDATION_ERROR',
        details: { fieldErrors },
        cause: err,
      });
    }
    throw err;
  }
}

module.exports = { validate, validateValue };
