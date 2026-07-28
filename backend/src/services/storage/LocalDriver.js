'use strict';

/**
 * Local filesystem storage driver — the dev and current-production driver.
 *
 * Objects live under `config.storage.uploadsDir` and are served by the
 * `express.static` mount in src/app.js at `config.storage.publicPath`, so a
 * stored `blogs/July2026/x.png` resolves to `/uploads/blogs/July2026/x.png`
 * without any per-request database work.
 *
 * The interesting part of this file is `resolveSafePath`. Every path that reaches
 * the filesystem goes through it, and it is the reason a request cannot read
 * `../../.env` or write outside the uploads tree. It validates the *string*
 * first (see StorageDriver.normaliseRelativePath) and then re-checks the
 * *resolved* absolute path against the root — belt and braces, because string
 * validation and `path.resolve` disagree in enough edge cases on Windows that
 * trusting either one alone is a bad bet.
 */

const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');

const config = require('../../config');
const ApiError = require('../../utils/ApiError');
const logger = require('../../utils/logger');
const StorageDriver = require('./StorageDriver');

/** Extension -> Content-Type, for the formats this app produces and accepts. */
const CONTENT_TYPES = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
});

/**
 * Guesses a Content-Type from a path's extension.
 * @param {string} relativePath
 * @returns {string} A concrete type, or `application/octet-stream` when unknown —
 *   never a guess that a browser might sniff as HTML.
 */
function contentTypeFor(relativePath) {
  return CONTENT_TYPES[path.extname(String(relativePath)).toLowerCase()] || 'application/octet-stream';
}

/**
 * Turns a storage-relative path into an absolute filesystem path that is
 * provably inside `root`.
 *
 * @param {string} relativePath e.g. `blogs/July2026/abc.png`.
 * @param {string} [root] Defaults to `config.storage.uploadsDir`. Injectable so
 *   the unit tests can point at a temp directory instead of the real uploads
 *   tree.
 * @returns {string} Absolute path.
 * @throws {ApiError} 400 when the path is unsafe.
 */
function resolveSafePath(relativePath, root = config.storage.uploadsDir) {
  const canonical = StorageDriver.normaliseRelativePath(relativePath);

  const absoluteRoot = path.resolve(root);
  const resolved = path.resolve(absoluteRoot, canonical);

  // The containment check. `path.relative` is the reliable form: a result that
  // is empty (the root itself), absolute, or starts with `..` means the path
  // escaped. Comparing prefixes with startsWith() would wrongly accept a
  // sibling directory whose name merely begins with the root's name
  // (`/data/uploads-evil` vs `/data/uploads`).
  const rel = path.relative(absoluteRoot, resolved);
  if (rel === '' || path.isAbsolute(rel) || rel.split(path.sep).includes('..')) {
    throw ApiError.badRequest('Storage path resolves outside the uploads directory.', {
      code: 'STORAGE_PATH_TRAVERSAL',
    });
  }

  return resolved;
}

class LocalDriver extends StorageDriver {
  /**
   * @param {object} [options]
   * @param {string} [options.uploadsDir] Filesystem root. Defaults to config.
   * @param {string} [options.publicPath] URL prefix. Defaults to config.
   */
  constructor({ uploadsDir, publicPath } = {}) {
    super('local');
    this.uploadsDir = path.resolve(uploadsDir || config.storage.uploadsDir);
    // Normalised to a leading slash with no trailing slash so joining is a
    // single template literal everywhere below.
    const prefix = publicPath === undefined ? config.storage.publicPath : publicPath;
    this.publicPath = `/${String(prefix || '').replace(/^\/+|\/+$/g, '')}`;
  }

  /**
   * Creates the uploads root. Idempotent via `recursive: true`, which is a no-op
   * on an existing directory rather than an EEXIST.
   * @returns {Promise<void>}
   */
  async ensureReady() {
    try {
      await fs.mkdir(this.uploadsDir, { recursive: true });
    } catch (err) {
      // A boot-time failure here means every upload will fail, so say exactly
      // which directory and why rather than letting a bare EACCES surface later
      // as a 500 on the first image.
      throw new ApiError(500, `Could not create the uploads directory at ${this.uploadsDir}.`, {
        code: 'STORAGE_NOT_WRITABLE',
        cause: err,
      });
    }
  }

  /**
   * Writes a buffer, creating the `blogs/{Month}{Year}/` directory on demand.
   * @param {Buffer} buffer
   * @param {{relativePath: string, contentType?: string}} options
   * @returns {Promise<{relativePath: string, publicUrl: string, bytes: number, contentType: string}>}
   */
  async save(buffer, { relativePath, contentType } = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw ApiError.badRequest('Cannot store an empty file.', { code: 'STORAGE_EMPTY_BUFFER' });
    }

    const canonical = StorageDriver.normaliseRelativePath(relativePath);
    const absolute = resolveSafePath(canonical, this.uploadsDir);

    await fs.mkdir(path.dirname(absolute), { recursive: true });
    // `wx` fails rather than overwrites. Filenames carry 40 random alphanumerics
    // (~190 bits), so a collision means something is wrong with the generator,
    // and silently overwriting another blog's cover image is the worst possible
    // way to find that out.
    try {
      await fs.writeFile(absolute, buffer, { flag: 'wx' });
    } catch (err) {
      if (err.code === 'EEXIST') {
        throw ApiError.conflict(`A file already exists at ${canonical}.`, {
          code: 'STORAGE_PATH_TAKEN',
          cause: err,
        });
      }
      throw new ApiError(500, 'Could not write the file to storage.', {
        code: 'STORAGE_WRITE_FAILED',
        cause: err,
      });
    }

    return {
      relativePath: canonical,
      publicUrl: this.toPublicUrl(canonical),
      bytes: buffer.length,
      contentType: contentType || contentTypeFor(canonical),
    };
  }

  /**
   * @param {string} relativePath
   * @returns {Promise<Buffer>}
   */
  async read(relativePath) {
    const absolute = resolveSafePath(relativePath, this.uploadsDir);
    try {
      return await fs.readFile(absolute);
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'EISDIR') {
        throw ApiError.notFound(`No stored file at ${relativePath}.`, {
          code: 'STORAGE_OBJECT_NOT_FOUND',
          cause: err,
        });
      }
      throw new ApiError(500, 'Could not read the file from storage.', {
        code: 'STORAGE_READ_FAILED',
        cause: err,
      });
    }
  }

  /**
   * @param {string} relativePath
   * @returns {Promise<boolean>}
   */
  async exists(relativePath) {
    let absolute;
    try {
      absolute = resolveSafePath(relativePath, this.uploadsDir);
    } catch {
      // An unsafe path does not exist as far as any caller is concerned, and
      // reporting "false" rather than throwing keeps this usable as a guard.
      return false;
    }
    try {
      const stat = await fs.stat(absolute);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  /**
   * @param {string} relativePath
   * @returns {Promise<boolean>} True when a file was removed.
   */
  async delete(relativePath) {
    const absolute = resolveSafePath(relativePath, this.uploadsDir);
    try {
      await fs.unlink(absolute);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw new ApiError(500, 'Could not delete the file from storage.', {
        code: 'STORAGE_DELETE_FAILED',
        cause: err,
      });
    }
  }

  /**
   * `blogs/July2026/x.png` -> `/uploads/blogs/July2026/x.png`.
   *
   * Returns '' rather than throwing for a bad path: this runs inside response
   * serialisation, where one malformed legacy row must not 500 the whole list.
   * @param {string} relativePath
   * @returns {string}
   */
  toPublicUrl(relativePath) {
    if (typeof relativePath !== 'string' || relativePath.trim() === '') return '';
    // Already a URL — some legacy rows and og_image values hold absolute URLs.
    if (/^https?:\/\//i.test(relativePath.trim())) return relativePath.trim();
    try {
      return `${this.publicPath}/${StorageDriver.normaliseRelativePath(relativePath)}`;
    } catch (err) {
      logger.warn('Refusing to build a public URL for an unsafe storage path.', {
        relativePath,
        reason: err.message,
      });
      return '';
    }
  }

  /** True when the configured uploads root exists and is writable right now. */
  isWritable() {
    try {
      fsSync.accessSync(this.uploadsDir, fsSync.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = { LocalDriver, resolveSafePath, contentTypeFor, CONTENT_TYPES };
