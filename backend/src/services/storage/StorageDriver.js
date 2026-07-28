'use strict';

/**
 * The storage driver contract, plus the path rules every driver must enforce.
 *
 * Everything in the app that persists a binary asset talks to this interface and
 * nothing else. That is the whole point: `blogs.blog_picture` and
 * `blogs.extra_images[].url` hold *storage-relative paths*
 * (`blogs/July2026/<40 chars>.png`), never URLs, so moving Divinetalk from local
 * disk to S3 is a change to `STORAGE_DRIVER` in `.env` plus one subclass — no
 * migration of stored rows and no edit to a controller or service.
 *
 * Subclasses must implement all six methods. The base class throws rather than
 * returning a benign default, because a silently-missing `save()` would look like
 * a successful upload that quietly lost the file.
 *
 * Path discipline lives here, in the contract, rather than in one driver: a
 * relative path may have been derived from request input, and `../` is just as
 * dangerous as an S3 key prefix as it is on a filesystem. Every driver runs the
 * path through `StorageDriver.normaliseRelativePath` before touching its store.
 */

const ApiError = require('../../utils/ApiError');

/**
 * Path segments that are always rejected. `.` and `..` are the traversal
 * primitives; the empty string catches `a//b`, which normalises differently
 * across platforms and is never something we generate.
 */
const FORBIDDEN_SEGMENTS = new Set(['', '.', '..']);

/** Longest path we accept, matching the STRING(500) columns that hold these. */
const MAX_RELATIVE_PATH_LENGTH = 500;

class StorageDriver {
  /**
   * @param {string} name Short driver identifier, mirrored in /health and logs.
   */
  constructor(name) {
    this.name = name;
  }

  /**
   * Validates a storage-relative path and returns it in canonical form
   * (forward slashes, no leading separator).
   *
   * This is the security boundary for the whole media feature, so it is a
   * deny-by-default character check rather than a normalise-and-hope. Rejected:
   *
   *   - `..` or `.` segments, in any position          `blogs/../../etc/passwd`
   *   - POSIX absolute paths                          `/etc/passwd`
   *   - Windows absolute paths and drive letters       `C:\Windows\x.png`
   *   - UNC paths                                     `\\server\share\x.png`
   *   - NUL bytes, which truncate the path in some
   *     native filesystem calls                        `ok.png\0../../evil`
   *   - percent signs, so a client cannot smuggle
   *     `%2e%2e` past a later decode step. Nothing we
   *     generate contains one, so rejecting outright
   *     costs nothing.
   *   - control characters and backslashes as data
   *
   * Backslashes are treated as separators, not as filename characters: on
   * Windows they *are* separators, and accepting them on Linux would let a path
   * that is safe in the test suite become traversal in production.
   *
   * @param {string} relativePath
   * @returns {string} Canonical `a/b/c.png` form.
   * @throws {ApiError} 400 with a specific reason.
   */
  static normaliseRelativePath(relativePath) {
    if (typeof relativePath !== 'string' || relativePath.trim() === '') {
      throw ApiError.badRequest('A storage path is required.', { code: 'STORAGE_PATH_INVALID' });
    }

    const raw = relativePath.trim();

    if (raw.length > MAX_RELATIVE_PATH_LENGTH) {
      throw ApiError.badRequest(
        `Storage path exceeds ${MAX_RELATIVE_PATH_LENGTH} characters.`,
        { code: 'STORAGE_PATH_INVALID' }
      );
    }
    if (raw.includes('\0')) {
      throw ApiError.badRequest('Storage path contains a NUL byte.', {
        code: 'STORAGE_PATH_INVALID',
      });
    }
    if (raw.includes('%')) {
      throw ApiError.badRequest(
        'Storage path must not be percent-encoded — pass the decoded path.',
        { code: 'STORAGE_PATH_INVALID' }
      );
    }
    // Written as a code-point scan rather than a regex so this file carries no
    // raw control bytes (see services/sanitize.js for the same reasoning).
    for (let i = 0; i < raw.length; i += 1) {
      const code = raw.charCodeAt(i);
      if (code < 0x20 || code === 0x7f) {
        throw ApiError.badRequest('Storage path contains a control character.', {
          code: 'STORAGE_PATH_INVALID',
        });
      }
    }
    // `C:`, `c:/`, and any other drive-qualified path. Checked before the
    // separator scan because `C:foo` has no separator at all yet is still
    // drive-relative on Windows.
    if (/^[a-z]:/i.test(raw)) {
      throw ApiError.badRequest('Storage path must not contain a drive letter.', {
        code: 'STORAGE_PATH_INVALID',
      });
    }

    const unified = raw.replace(/\\/g, '/');

    // A leading separator (or two, for UNC) means the caller is addressing the
    // filesystem root, not our uploads tree.
    if (unified.startsWith('/')) {
      throw ApiError.badRequest('Storage path must be relative, not absolute.', {
        code: 'STORAGE_PATH_INVALID',
      });
    }

    const segments = unified.split('/');
    for (const segment of segments) {
      if (FORBIDDEN_SEGMENTS.has(segment)) {
        throw ApiError.badRequest('Storage path must not contain "." or ".." segments.', {
          code: 'STORAGE_PATH_TRAVERSAL',
        });
      }
      // Windows resolves a trailing dot or space away, so `evil.png.` and
      // `evil.png ` address the same file as `evil.png` — a classic way to slip
      // past an extension check.
      if (/[. ]$/.test(segment)) {
        throw ApiError.badRequest('Storage path segments must not end with a dot or space.', {
          code: 'STORAGE_PATH_INVALID',
        });
      }
    }

    return segments.join('/');
  }

  /** Method the concrete driver forgot to implement. */
  unimplemented(method) {
    return new ApiError(500, `Storage driver "${this.name}" does not implement ${method}().`, {
      code: 'STORAGE_NOT_IMPLEMENTED',
    });
  }

  /**
   * Creates whatever the driver needs before its first write (a directory tree
   * locally, a reachability check remotely). Called once on boot and must be
   * idempotent.
   * @returns {Promise<void>}
   */
  async ensureReady() {
    throw this.unimplemented('ensureReady');
  }

  /**
   * Persists a buffer at `relativePath`.
   * @param {Buffer} buffer
   * @param {{relativePath: string, contentType?: string}} options
   * @returns {Promise<{relativePath: string, publicUrl: string, bytes: number, contentType: string}>}
   */
  /* eslint-disable-next-line no-unused-vars */
  async save(buffer, options) {
    throw this.unimplemented('save');
  }

  /**
   * Reads a stored object back into memory. Needed when re-compositing a logo
   * onto an image that is already stored.
   * @param {string} relativePath
   * @returns {Promise<Buffer>}
   */
  /* eslint-disable-next-line no-unused-vars */
  async read(relativePath) {
    throw this.unimplemented('read');
  }

  /**
   * @param {string} relativePath
   * @returns {Promise<boolean>} False for a missing object *and* for an unsafe
   *   path, so callers can use this as a cheap pre-flight check without catching.
   */
  /* eslint-disable-next-line no-unused-vars */
  async exists(relativePath) {
    throw this.unimplemented('exists');
  }

  /**
   * Removes a stored object. Idempotent: deleting something that is already gone
   * resolves `false` rather than throwing, because the caller's goal ("this asset
   * should not exist") is already satisfied.
   * @param {string} relativePath
   * @returns {Promise<boolean>} True if an object was actually removed.
   */
  /* eslint-disable-next-line no-unused-vars */
  async delete(relativePath) {
    throw this.unimplemented('delete');
  }

  /**
   * Resolves a stored path to a URL a browser can fetch. Pure string work, no
   * I/O, so it is safe to call while serialising a page of blogs.
   * @param {string} relativePath
   * @returns {string} The URL, or '' when the path is absent or unsafe.
   */
  /* eslint-disable-next-line no-unused-vars */
  toPublicUrl(relativePath) {
    throw this.unimplemented('toPublicUrl');
  }
}

module.exports = StorageDriver;
module.exports.FORBIDDEN_SEGMENTS = FORBIDDEN_SEGMENTS;
module.exports.MAX_RELATIVE_PATH_LENGTH = MAX_RELATIVE_PATH_LENGTH;
