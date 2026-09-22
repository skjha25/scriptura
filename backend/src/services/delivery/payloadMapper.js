'use strict';

/**
 * Applies a `publishing_field_mappings` config to a real `Blog` row and
 * produces the JSON payload a client's endpoint expects.
 *
 * `BLOG_FIELD_ALLOWLIST` is the ONLY source of `scriptura_field` values —
 * derived directly from the real Blog model's actual columns (never an
 * invented/aspirational field), grouped the way the Config UI's field-mapping
 * dropdown groups them (Blog / SEO / Images / Publishing).
 */

const { BLOG_STATUS_LABELS } = require('../../constants');
const { absolutizeBlogLinks } = require('../publicLinks');

function toIso(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** `YYYY-MM-DD` — the plain-date shape a Laravel `date` rule expects, not a full timestamp. */
function toDateOnly(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function addYears(date, years) {
  if (!date) return null;
  const d = date instanceof Date ? new Date(date.getTime()) : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

const BLOG_FIELD_ALLOWLIST = Object.freeze({
  'blog.title': { label: 'Title', category: 'Blog', resolve: (blog) => blog.blog_title || null },
  'blog.slug': { label: 'Slug', category: 'Blog', resolve: (blog) => blog.slug || null },
  'blog.content': { label: 'Content (HTML)', category: 'Blog', resolve: (blog) => absolutizeBlogLinks(blog.blog_content) || null },
  'blog.word_count': { label: 'Word Count', category: 'Blog', resolve: (blog) => blog.word_count ?? null },

  'seo.meta_title': { label: 'Meta Title', category: 'SEO', resolve: (blog) => blog.meta_title || null },
  'seo.meta_description': { label: 'Meta Description', category: 'SEO', resolve: (blog) => blog.meta_description || null },
  'seo.canonical_url': { label: 'Canonical URL', category: 'SEO', resolve: (blog) => blog.canonical_url || null },
  'seo.seo_score': { label: 'SEO Score', category: 'SEO', resolve: (blog) => blog.seo_score ?? null },
  'seo.aeo_score': { label: 'AEO Score', category: 'SEO', resolve: (blog) => blog.aeo_score ?? null },
  'seo.geo_score': { label: 'GEO Score', category: 'SEO', resolve: (blog) => blog.geo_score ?? null },

  // `kind: 'file'` marks this as the one field a `request_format: 'multipart'`
  // integration fetches and sends as a real uploaded file (see
  // clientDeliveryService.js) instead of a text form field — e.g. DivineTalk's
  // `blog_picture` validates with Laravel's `image` rule, which rejects a URL
  // string. JSON-format integrations still just get the URL, unaffected.
  //
  // `blog.blog_picture` — NOT `blog.og_image` — is the real primary/cover
  // image column: the only one the actual generation pipeline ever writes to
  // (services/generation.js sets `blog.blog_picture = generatedImages[0].relativePath`
  // for the hero image). `og_image` is a separate, rarely-used column with no
  // writer anywhere in the generation/publish pipeline — only manually
  // patchable — so a real blog can (and typically does) have a visible cover
  // image while `og_image` stays permanently null. This mapping originally
  // pointed at `og_image`, which is why every real delivery failed
  // "blog_picture: no value available" despite the blog clearly showing an
  // image.
  //
  // It's a storage-relative path (e.g. "blogs/July2026/xyz.png"), not a URL.
  // `publicUrlFor` (same helper the blog API response itself uses for
  // `blog_picture_url`) resolves it, but under `STORAGE_DRIVER=local` that
  // only produces a root-relative path (`/uploads/...` or
  // `/scriptura/uploads/...`) meant to be combined with whatever origin the
  // frontend is served from — useless to an external client (can't resolve
  // it) or to this server's own outbound fetch for a multipart attachment
  // (needs an absolute URL). `config.appUrl` (the backend's own real
  // reachable origin — MUST be a correct public URL in production, not the
  // localhost default) makes it absolute. A URL a driver already returns
  // absolute (S3, or a legacy row) passes through unchanged. Required
  // lazily: blogService pulls in the storage driver at load time, and this
  // module is required by contexts (validators, tests) that don't need it.
  'images.featured_image': {
    label: 'Featured Image (Cover / blog_picture)',
    category: 'Images',
    kind: 'file',
    resolve: (blog) => {
      const url = require('../blogService').publicUrlFor(blog.blog_picture);
      if (!url) return null;
      if (/^https?:\/\//i.test(url)) return url;
      const config = require('../../config');
      return `${config.appUrl.replace(/\/$/, '')}${url}`;
    },
  },

  'publishing.status': {
    label: 'Status',
    category: 'Publishing',
    resolve: (blog) => BLOG_STATUS_LABELS[blog.blog_status] || null,
  },
  // Raw numeric status (0/1/2/3, see BLOG_STATUS) — for a client whose own
  // validation expects a code rather than our label string.
  'publishing.status_code': {
    label: 'Status (numeric code)',
    category: 'Publishing',
    resolve: (blog) => (typeof blog.blog_status === 'number' ? blog.blog_status : null),
  },
  'publishing.published_by': { label: 'Published By', category: 'Publishing', resolve: (blog) => blog.published_by || null },
  'publishing.publish_date': { label: 'Publish Date', category: 'Publishing', resolve: (blog) => toIso(blog.publish_date) },
  // For a client API that models content as having a validity window (e.g. a
  // required start/end date pair) rather than a single publish date. Start =
  // the real publish date; end is a fixed 15 years out — effectively
  // "never expires" for a blog post, chosen per the integration owner rather
  // than left blank against a `required` rule.
  'publishing.start_date': { label: 'Start Date (= publish date)', category: 'Publishing', resolve: (blog) => toDateOnly(blog.publish_date) },
  'publishing.end_date': {
    label: 'End Date (publish date + 15 years)',
    category: 'Publishing',
    resolve: (blog) => toDateOnly(addYears(blog.publish_date, 15)),
  },
});

/** For the Config UI's field-mapping dropdown — {value, label, category}[]. */
function listAvailableFields() {
  return Object.entries(BLOG_FIELD_ALLOWLIST).map(([value, { label, category }]) => ({ value, label, category }));
}

/** Sets `value` at a dot-path within `target`, creating intermediate objects as needed. */
function setAtPath(target, path, value) {
  const keys = String(path).split('.').filter(Boolean);
  let cursor = target;
  keys.forEach((key, i) => {
    if (i === keys.length - 1) {
      cursor[key] = value;
    } else {
      if (typeof cursor[key] !== 'object' || cursor[key] === null || Array.isArray(cursor[key])) {
        cursor[key] = {};
      }
      cursor = cursor[key];
    }
  });
}

function isEmpty(value) {
  return value === null || value === undefined || value === '';
}

/**
 * @param {import('../../models').Blog} blog
 * @param {Array<{client_field:string, source_type:'field'|'static', scriptura_field:?string, static_value:?string, is_required:boolean}>} mappings
 * @returns {{payload: object, fieldNames: string[], missingRequired: Array<{client_field:string}>, fileFields: Array<{client_field:string, url:string}>}}
 */
function buildPayload(blog, mappings) {
  const payload = {};
  const fieldNames = [];
  const missingRequired = [];
  // Mapped fields whose scriptura_field is `kind: 'file'` (currently only
  // images.featured_image) — a `request_format: 'multipart'` integration
  // fetches these and attaches real file bytes instead of sending `value` as
  // text. Still present in `payload` too, so JSON-format integrations are
  // unaffected.
  const fileFields = [];

  const sorted = [...(mappings || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  for (const mapping of sorted) {
    fieldNames.push(mapping.client_field);

    let value;
    let field = null;
    if (mapping.source_type === 'static') {
      value = mapping.static_value ?? null;
    } else {
      field = BLOG_FIELD_ALLOWLIST[mapping.scriptura_field];
      value = field ? field.resolve(blog) : null;
    }

    if (mapping.is_required && isEmpty(value)) {
      missingRequired.push({ client_field: mapping.client_field });
      continue;
    }
    if (isEmpty(value)) continue; // optional + unresolved — omitted, never sent as null unless static_value was explicitly null-ish text.

    setAtPath(payload, mapping.client_field, value);
    if (field && field.kind === 'file') {
      fileFields.push({ client_field: mapping.client_field, url: value });
    }
  }

  return { payload, fieldNames, missingRequired, fileFields };
}

module.exports = { BLOG_FIELD_ALLOWLIST, listAvailableFields, buildPayload, setAtPath };
