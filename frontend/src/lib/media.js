// frontend/src/lib/media.js
/**
 * Image URL resolution.
 *
 * The database stores storage-relative paths (`blogs/July2026/xxx.png`), never
 * URLs — that is what lets the same row work under the local disk driver and
 * under S3. The API resolves the primary image for us (`blog_picture_url`), but
 * paths inside `content_blocks` are raw, so the renderer needs a resolver.
 */

/** Where the API serves uploads from. Matches STORAGE_PUBLIC_PATH on the server. */
const UPLOADS_PREFIX = '/uploads';

/**
 * Turns a stored image reference into something an `<img src>` can load.
 *
 * Already-absolute URLs pass through untouched, which covers both externally
 * hosted images and the case where the storage driver is S3 and the backend has
 * handed us a CDN URL.
 *
 * @param {string|null|undefined} pathOrUrl
 * @returns {string} A loadable URL, or '' when there is nothing to load.
 */
export function resolveImageUrl(pathOrUrl) {
  if (typeof pathOrUrl !== 'string' || pathOrUrl.trim() === '') return '';
  const value = pathOrUrl.trim();

  if (/^https?:\/\//i.test(value)) return value;
  // Already resolved to a root-relative public path.
  if (value.startsWith(UPLOADS_PREFIX)) return prefixApiHost(value);
  if (value.startsWith('/')) return prefixApiHost(value);

  return prefixApiHost(`${UPLOADS_PREFIX}/${value.replace(/^\/+/, '')}`);
}

/**
 * Prepends the API host when the frontend is served from a different origin.
 *
 * In development CRA's `proxy` forwards /uploads to :5000, so a relative path
 * works and no host is added. In a split deployment REACT_APP_API_URL is set and
 * the images live with the API.
 */
function prefixApiHost(path) {
  const host = process.env.REACT_APP_API_URL;
  if (!host) return path;
  return `${host.replace(/\/$/, '')}${path}`;
}

export default resolveImageUrl;
