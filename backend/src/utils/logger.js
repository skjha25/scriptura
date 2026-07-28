'use strict';

/**
 * Minimal levelled logger.
 *
 * Deliberately not pino/winston: the app has no log-shipping requirement yet,
 * and a 40-line wrapper over console keeps the dependency surface small. The
 * call signature matches the common `logger.info(msg, meta)` shape, so swapping
 * in a real logger later is a change to this file only.
 *
 * Silent under NODE_ENV=test so test output stays readable — except errors,
 * which are kept when DEBUG_TESTS=1 to make failures diagnosable.
 */

const config = require('../config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

// Resolved in src/config so this module reads no environment of its own — see
// that file's header for why env access is centralised.
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

function emit(level, stream, message, meta) {
  if (LEVELS[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
  if (meta === undefined) {
    stream(line);
    return;
  }
  // Errors do not survive JSON.stringify; unwrap them into something readable.
  const payload =
    meta instanceof Error
      ? { name: meta.name, message: meta.message, stack: meta.stack }
      : meta;
  try {
    stream(`${line} ${JSON.stringify(payload)}`);
  } catch {
    // Circular structure — fall back to the default inspector.
    stream(line, payload);
  }
}

module.exports = {
  debug: (message, meta) => emit('debug', console.log, message, meta),
  info: (message, meta) => emit('info', console.log, message, meta),
  warn: (message, meta) => emit('warn', console.warn, message, meta),
  error: (message, meta) => emit('error', console.error, message, meta),
  /** Exposed for tests that assert on log suppression. */
  _threshold: threshold,
};
