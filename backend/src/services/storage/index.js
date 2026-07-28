'use strict';

/**
 * Storage facade — the only storage entry point business logic should import.
 *
 * Controllers and services call `saveImage()` / `toPublicUrl()` and never learn
 * which driver is behind them. That is what makes the S3 migration a `.env`
 * change: `STORAGE_DRIVER=s3` swaps the object returned by `getDriver()` and no
 * caller notices.
 *
 * THE PATH CONVENTION IS CONTRACTUAL. Divinetalk's live `blogs` table already
 * holds values of the form:
 *
 *   blogs/July2026/Mkz67Ed9NRSC9sTzvmLWbJyNbf1cSt0n85YmSG9q.png
 *   ^^^^^ ^^^^ ^^^^ ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ^^^
 *   prefix month year   40 random alphanumerics               ext
 *
 * Full English month name, no separator before the year. Anything we write must
 * match, because other systems already read those paths and the `express.static`
 * mount in src/app.js serves that exact shape. `buildStoragePath()` below is the
 * single implementation; src/seeders/20260727130100-seed-blogs.js documents the
 * same convention for seed data.
 */

const crypto = require('crypto');

const config = require('../../config');
const ApiError = require('../../utils/ApiError');
const logger = require('../../utils/logger');
const StorageDriver = require('./StorageDriver');
const { LocalDriver, resolveSafePath, contentTypeFor } = require('./LocalDriver');
const { S3Driver } = require('./S3Driver');

/** Top-level prefix every blog asset lives under, matching production. */
const STORAGE_PREFIX = 'blogs';

/**
 * Length of the random filename segment in existing production paths.
 *
 * 40, measured from the live data: the sample row's filename
 * `Mkz67Ed9NRSC9sTzvmLWbJyNbf1cSt0n85YmSG9q` is exactly 40 alphanumerics, which
 * is Laravel's `Str::random(40)` default — consistent with the existing site
 * writing these paths. Matching it means a path minted here is
 * indistinguishable from a legacy one, so anything that parses or validates
 * these filenames keeps working.
 */
const RANDOM_NAME_LENGTH = 40;

/** Extensions we will mint a path for. Keeps a caller from inventing `.php`. */
const ALLOWED_EXTENSIONS = Object.freeze(['png', 'jpg', 'jpeg', 'webp']);

/**
 * 40 URL-safe alphanumerics, matching the production filenames.
 *
 * base64url is generated and then stripped of `-`/`_`, so the alphabet is
 * `[A-Za-z0-9]` exactly as in the live data. Stripping shortens the string, so
 * this loops until it has enough rather than slicing a single fixed-size draw
 * and risking a short name.
 *
 * @param {number} [length]
 * @returns {string}
 */
function randomFileName(length = RANDOM_NAME_LENGTH) {
  let out = '';
  while (out.length < length) {
    out += crypto.randomBytes(24).toString('base64url').replace(/[_-]/g, '');
  }
  return out.slice(0, length);
}

/**
 * `blogs/{Month}{Year}/{40 alphanumerics}.{ext}`.
 *
 * The month/year folder is derived from the supplied date (now, by default) and
 * uses the `en-US` full month name so the folder reads identically regardless of
 * the server's locale — a machine set to `de-DE` must not start writing
 * `blogs/Juli2026/`.
 *
 * @param {object} [options]
 * @param {string} [options.ext] Extension without the dot. Default 'png'.
 * @param {Date} [options.date] Bucketing date. Default now.
 * @param {string} [options.prefix] Top-level folder. Default 'blogs'.
 * @returns {string} A storage-relative path.
 */
function buildStoragePath({ ext = 'png', date = new Date(), prefix = STORAGE_PREFIX } = {}) {
  const cleanExt = String(ext).replace(/^\./, '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(cleanExt)) {
    throw ApiError.badRequest(
      `Unsupported image extension ".${cleanExt}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}.`,
      { code: 'STORAGE_EXTENSION_UNSUPPORTED' }
    );
  }
  const when = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const month = when.toLocaleString('en-US', { month: 'long' });
  return `${prefix}/${month}${when.getFullYear()}/${randomFileName()}.${cleanExt}`;
}

// ---------------------------------------------------------------------------
// Driver factory
// ---------------------------------------------------------------------------

/**
 * Memoised so a single process holds one driver. The local driver caches its
 * resolved root, and constructing S3Driver runs config validation — neither
 * wants to happen on every upload.
 */
let driverInstance = null;

/**
 * Returns the configured driver, constructing it on first use.
 *
 * @param {object} [overrides] Ad-hoc driver configuration, used by tests and by
 *   any future admin tooling that needs to address a second bucket. Passing
 *   overrides bypasses the memo and returns a fresh, unmemoised instance.
 * @returns {StorageDriver}
 */
function getDriver(overrides) {
  if (overrides) {
    const driver = String(overrides.driver || config.storage.driver).toLowerCase();
    if (driver === 's3') return new S3Driver(overrides.s3 || config.storage.s3);
    return new LocalDriver(overrides);
  }

  if (driverInstance) return driverInstance;

  if (config.storage.driver === 's3') {
    // Throws when S3_* are incomplete — deliberately, and on boot rather than at
    // first upload. See S3Driver's header.
    driverInstance = new S3Driver();
  } else {
    driverInstance = new LocalDriver();
  }
  return driverInstance;
}

/**
 * Drops the memoised driver. For tests that change configuration between cases;
 * production code has no reason to call it.
 * @returns {void}
 */
function resetDriver() {
  driverInstance = null;
}

// ---------------------------------------------------------------------------
// High-level helpers — what business logic actually calls
// ---------------------------------------------------------------------------

/**
 * Prepares storage for use. Called once from src/server.js on boot so the first
 * image write cannot fail on a fresh clone with no `uploads/` directory.
 *
 * Idempotent: safe to call repeatedly, and does so via `mkdir -p` semantics
 * rather than an exists-then-create race.
 *
 * @returns {Promise<{driver: string, ready: true}>}
 */
async function ensureStorageReady() {
  const driver = getDriver();
  await driver.ensureReady();
  logger.debug(`Storage ready (driver=${driver.name}).`);
  return { driver: driver.name, ready: true };
}

/**
 * Stores an image buffer at a freshly minted production-convention path.
 *
 * This is the function every image producer in the app uses — uploads, AI
 * generation, and logo re-compositing all funnel through it, so the path
 * convention is applied in exactly one place.
 *
 * @param {Buffer} buffer
 * @param {object} [options]
 * @param {string} [options.ext] Extension without the dot; defaults to 'png'.
 * @param {string} [options.contentType]
 * @param {Date} [options.date] Month/year bucket. Defaults to now.
 * @returns {Promise<{relativePath: string, publicUrl: string, bytes: number, contentType: string}>}
 */
async function saveImage(buffer, { ext = 'png', contentType, date } = {}) {
  const relativePath = buildStoragePath({ ext, date });
  return getDriver().save(buffer, {
    relativePath,
    contentType: contentType || contentTypeFor(relativePath),
  });
}

/**
 * Stores a buffer at a caller-chosen path. Use `saveImage` unless the path is
 * already fixed (e.g. re-writing a known asset).
 * @param {Buffer} buffer
 * @param {{relativePath: string, contentType?: string}} options
 */
async function saveBuffer(buffer, options) {
  return getDriver().save(buffer, options);
}

/**
 * @param {string} relativePath
 * @returns {Promise<Buffer>}
 */
async function readFile(relativePath) {
  return getDriver().read(relativePath);
}

/**
 * @param {string} relativePath
 * @returns {Promise<boolean>}
 */
async function fileExists(relativePath) {
  return getDriver().exists(relativePath);
}

/**
 * @param {string} relativePath
 * @returns {Promise<boolean>}
 */
async function deleteFile(relativePath) {
  return getDriver().delete(relativePath);
}

/**
 * Resolves a stored path to a browser-fetchable URL.
 *
 * The counterpart to storing relative paths in the database: the DB stays
 * driver-agnostic and this is the single place that knows whether `/uploads` or
 * a CDN host is in front of it.
 *
 * @param {string} relativePath
 * @returns {string} The URL, or '' for an absent or unsafe path.
 */
function toPublicUrl(relativePath) {
  return getDriver().toPublicUrl(relativePath);
}

module.exports = {
  // Facade
  ensureStorageReady,
  saveImage,
  saveBuffer,
  readFile,
  fileExists,
  deleteFile,
  toPublicUrl,

  // Factory
  getDriver,
  resetDriver,

  // Path convention and safety, exported for the unit tests and for callers that
  // need to validate a client-supplied path before doing anything with it.
  buildStoragePath,
  randomFileName,
  resolveSafePath,
  normaliseRelativePath: StorageDriver.normaliseRelativePath,
  contentTypeFor,

  // Drivers, for tests and for direct construction against a non-default root.
  StorageDriver,
  LocalDriver,
  S3Driver,

  STORAGE_PREFIX,
  RANDOM_NAME_LENGTH,
  ALLOWED_EXTENSIONS,
};
