'use strict';

/**
 * S3 storage driver — DELIBERATELY UNIMPLEMENTED.
 *
 * Why it exists at all: the S3 swap is a `.env` change, and the value of proving
 * that is having the seam actually present. This class holds the seam open and,
 * more usefully, makes a misconfiguration *loud*.
 *
 * Two behaviours are intentional and worth reading before "fixing" this file:
 *
 *   1. The constructor validates its configuration and throws. Setting
 *      `STORAGE_DRIVER=s3` therefore fails on boot, naming the exact environment
 *      variables that are missing, instead of appearing to work until the first
 *      person uploads an image and gets an opaque 500 hours later.
 *
 *   2. `toPublicUrl()` is fully implemented, while the I/O methods throw. That
 *      asymmetry is the point of the whole abstraction: a `blogs` row written by
 *      the local driver holds a plain relative path, so once
 *      `S3_PUBLIC_BASE_URL` is set, every existing row already resolves to its
 *      CDN URL. Nothing about the stored data changes when the driver does.
 *
 * No aws-sdk dependency is added — an unused ~15MB transitive tree is not worth
 * carrying for a stub. Implementing this means installing
 * `@aws-sdk/client-s3` and replacing the four `notImplemented()` bodies with
 * PutObject / GetObject / HeadObject / DeleteObject. The path convention,
 * validation and public-URL logic below need no changes.
 */

const config = require('../../config');
const ApiError = require('../../utils/ApiError');
const StorageDriver = require('./StorageDriver');

/** Env vars that must be present before the driver can be constructed. */
const REQUIRED_ENV = Object.freeze({
  bucket: 'S3_BUCKET',
  region: 'S3_REGION',
  accessKeyId: 'S3_ACCESS_KEY_ID',
  secretAccessKey: 'S3_SECRET_ACCESS_KEY',
  publicBaseUrl: 'S3_PUBLIC_BASE_URL',
});

class S3Driver extends StorageDriver {
  /**
   * @param {object} [s3Config] Defaults to `config.storage.s3`. Injectable so the
   *   unit tests can exercise both the valid and the missing-config branches
   *   without mutating the frozen config object.
   * @throws {ApiError} 500 listing every environment variable that is unset.
   */
  constructor(s3Config = config.storage.s3) {
    super('s3');

    const provided = s3Config || {};
    const missing = Object.entries(REQUIRED_ENV)
      .filter(([key]) => !String(provided[key] || '').trim())
      .map(([, envVar]) => envVar);

    if (missing.length > 0) {
      throw new ApiError(
        500,
        'STORAGE_DRIVER=s3 is selected but the S3 configuration is incomplete. ' +
          `Set ${missing.join(', ')} in backend/.env, or set STORAGE_DRIVER=local.`,
        { code: 'STORAGE_MISCONFIGURED', details: { missing } }
      );
    }

    this.bucket = provided.bucket;
    this.region = provided.region;
    // Trailing slash stripped so joining is a single template literal, matching
    // LocalDriver.
    this.publicBaseUrl = String(provided.publicBaseUrl).replace(/\/+$/, '');
    // Credentials are held but never logged. Nothing in this class prints them,
    // and ApiError details above deliberately name variables, not values.
    this.accessKeyId = provided.accessKeyId;
    this.secretAccessKey = provided.secretAccessKey;
  }

  /**
   * The single error every I/O method raises, so the message a developer sees is
   * identical no matter which call they hit first.
   * @param {string} operation
   * @returns {ApiError}
   */
  notImplemented(operation) {
    return new ApiError(
      501,
      `The S3 storage driver is a stub: ${operation}() is not implemented. ` +
        'Install @aws-sdk/client-s3 and complete src/services/storage/S3Driver.js, ' +
        'or set STORAGE_DRIVER=local in backend/.env to use the local disk driver. ' +
        `Configuration currently read from: ${Object.values(REQUIRED_ENV).join(', ')}.`,
      { code: 'STORAGE_DRIVER_STUBBED', details: { driver: 's3', operation } }
    );
  }

  /**
   * A bucket cannot be created from here, so there is nothing to prepare — but
   * this must not throw, or `STORAGE_DRIVER=s3` would fail on boot for a reason
   * unrelated to the actual gap. The constructor already did the fail-fast work.
   * @returns {Promise<void>}
   */
  async ensureReady() {
    // Intentionally a no-op. See the note above.
  }

  /* eslint-disable-next-line no-unused-vars */
  async save(buffer, options) {
    throw this.notImplemented('save');
  }

  /* eslint-disable-next-line no-unused-vars */
  async read(relativePath) {
    throw this.notImplemented('read');
  }

  /* eslint-disable-next-line no-unused-vars */
  async exists(relativePath) {
    throw this.notImplemented('exists');
  }

  /* eslint-disable-next-line no-unused-vars */
  async delete(relativePath) {
    throw this.notImplemented('delete');
  }

  /**
   * `blogs/July2026/x.png` -> `https://cdn.divinetalk.in/blogs/July2026/x.png`.
   *
   * Implemented, unlike the I/O methods — see the file header for why.
   * @param {string} relativePath
   * @returns {string} The URL, or '' when the path is absent or unsafe.
   */
  toPublicUrl(relativePath) {
    if (typeof relativePath !== 'string' || relativePath.trim() === '') return '';
    if (/^https?:\/\//i.test(relativePath.trim())) return relativePath.trim();
    try {
      return `${this.publicBaseUrl}/${StorageDriver.normaliseRelativePath(relativePath)}`;
    } catch {
      return '';
    }
  }
}

module.exports = { S3Driver, REQUIRED_ENV };
