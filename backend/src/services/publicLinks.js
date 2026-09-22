'use strict';

/**
 * Internal blog links must point at the public site.
 *
 * The model writes internal links as `/blog/<slug>`. A root-relative href takes
 * the host of whatever page shows it, so the same link resolved to
 * `dev-list.divinetalk.live/blog/...` in Scriptura and `admin.divinetalk.live/
 * blog/...` in the DivineTalk admin, and neither host serves blog pages. Only
 * `divinetalk.in` does, so every internal blog link is made absolute on it.
 */

const { SITE_IDENTITY } = require('../constants');

/** Public site that serves `/blog/<slug>`. No trailing slash. */
const PUBLIC_SITE_URL = SITE_IDENTITY.production_urls[0];

/** Our own non-public hosts (Scriptura, DivineTalk admin) that cannot serve a blog page. */
const NON_PUBLIC_HOST_RE = /(^|\.)divinetalk\.live$/i;

/**
 * Rewrites one href to the public site when it is an internal blog link.
 * Every other href (external sites, mailto, anchors, other paths) is returned unchanged.
 *
 * @param {string} href
 * @returns {string}
 */
function toPublicBlogHref(href) {
  const value = String(href ?? '').trim();

  if (/^\/blog\//i.test(value)) return `${PUBLIC_SITE_URL}${value}`;

  const absolute = /^https?:\/\/([^/?#]+)(\/blog\/.*)$/i.exec(value);
  if (absolute && NON_PUBLIC_HOST_RE.test(absolute[1])) return `${PUBLIC_SITE_URL}${absolute[2]}`;

  return href;
}

/**
 * Rewrites every internal blog link inside an HTML string.
 *
 * @param {string} html
 * @returns {string}
 */
function absolutizeBlogLinks(html) {
  if (typeof html !== 'string' || html === '') return html;
  return html.replace(
    /(<a\s[^>]*?href=)(["'])([^"']*)\2/gi,
    (match, prefix, quote, href) => `${prefix}${quote}${toPublicBlogHref(href)}${quote}`
  );
}

module.exports = { PUBLIC_SITE_URL, toPublicBlogHref, absolutizeBlogLinks };
