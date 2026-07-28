'use strict';

/**
 * Slug generation.
 *
 * Slugs are the public addressing key for a blog, so they must be stable, safe
 * in a URL, and unique. The existing production titles include Devanagari and
 * typographic punctuation ("Embrace Shrawan's Energy: A Cosmic Shift"), so
 * transliteration and aggressive stripping both matter.
 */

const slugify = require('slugify');

/** Longest slug we will emit, leaving room for a `-NN` uniqueness suffix. */
const MAX_SLUG_LENGTH = 240;

/**
 * Converts arbitrary text into a URL slug.
 *
 * Returns an empty string for input that contains no sluggable characters
 * (e.g. only emoji); callers decide what to do about that rather than getting a
 * surprise value.
 *
 * @param {string} input
 * @returns {string} lowercase, hyphen-separated, `[a-z0-9-]` only.
 */
function slugifyTitle(input) {
  if (typeof input !== 'string' || input.trim() === '') return '';

  let slug = slugify(input, {
    lower: true,
    strict: true, // drop characters that are not alphanumeric or the separator
    trim: true,
    locale: 'en',
    remove: /[*+~.()'"!:@?#$%^&=<>{}[\]|\\/,;]/g,
  });

  // `strict` leaves non-Latin scripts untouched, which would produce a slug
  // that is legal but opaque in a URL bar. Drop anything still outside the
  // target charset and collapse the gaps it leaves behind.
  slug = slug
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length <= MAX_SLUG_LENGTH) return slug;

  // Truncate on a word boundary so the slug does not end mid-word.
  const truncated = slug.slice(0, MAX_SLUG_LENGTH);
  const lastHyphen = truncated.lastIndexOf('-');
  return (lastHyphen > MAX_SLUG_LENGTH * 0.6 ? truncated.slice(0, lastHyphen) : truncated).replace(
    /-+$/,
    ''
  );
}

/**
 * Produces a slug that is not yet taken, appending `-2`, `-3`, … as needed.
 *
 * Note on concurrency: this is check-then-write, so two simultaneous inserts of
 * the same title can both settle on the same suffix. That is acceptable because
 * the `blogs_slug_unique` index is the real guarantee — the loser gets a
 * UniqueConstraintError, which the error handler surfaces as a 409. Doing it
 * this way keeps the common path to a single indexed query instead of a
 * transaction with a lock.
 *
 * @param {string} title Source text, normally blog_title.
 * @param {object} [options]
 * @param {number|string} [options.excludeId] Ignore this row when checking, so
 *   re-saving an existing blog does not collide with itself.
 * @param {number} [options.maxAttempts] Suffixes to try before falling back to
 *   a random discriminator.
 */
async function generateUniqueSlug(title, { excludeId, maxAttempts = 50 } = {}) {
  // Required lazily: models/blog.js requires this module from a hook, and a
  // top-level require here would close an import cycle at load time.
  const { Op } = require('sequelize');
  const { Blog } = require('../models');

  const base = slugifyTitle(title) || 'blog';

  // One query fetches every slug in the family, so N candidate checks cost one
  // round trip instead of N. `paranoid: false` is important: a soft-deleted row
  // still occupies the unique index, so its slug is still taken.
  const existing = await Blog.findAll({
    attributes: ['slug'],
    where: {
      slug: { [Op.like]: `${base}%` },
      ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
    },
    paranoid: false,
    raw: true,
  });

  const taken = new Set(existing.map((row) => row.slug).filter(Boolean));
  if (!taken.has(base)) return base;

  for (let suffix = 2; suffix <= maxAttempts; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }

  // Pathological case (50+ blogs sharing a title). A short random suffix ends
  // the loop deterministically rather than scanning forever.
  return `${base}-${Date.now().toString(36).slice(-5)}`;
}

module.exports = { slugifyTitle, generateUniqueSlug, MAX_SLUG_LENGTH };
