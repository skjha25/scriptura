'use strict';

/**
 * Internal blog links: verify, repair, absolutize.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The article prompt hands the model the exact URL of every link target
 * (`prompts.js` -> `internal_link_targets`). The model does not always copy it.
 * It regularly rebuilds the slug from the target's *title* instead, and while
 * doing so it writes the title the way a person would say it out loud — with a
 * joining word where the real title had a comma. Two production examples, both
 * an inserted `and`:
 *
 *   written : /blog/sarva-pitru-amavasya-2026-date-tithi-shradh-muhurat-and-puja-vidhi
 *   real    : /blog/sarva-pitru-amavasya-2026-date-tithi-shradh-muhurat-puja-vidhi
 *
 *   written : /blog/pitru-paksha-2026-complete-dates-tithi-calendar-and-shradh-timings
 *   real    : /blog/pitru-paksha-2026-complete-dates-tithi-calendar-shradh-timings
 *
 * The destination exists; only the address is wrong, so the reader gets a 404
 * on divinetalk.in and the internal link is worth nothing.
 *
 * The previous check only stripped links it could not resolve, and only inside
 * `data.html`. That was wrong twice over: a repairable link was destroyed
 * rather than fixed, and a link living in a list item, FAQ answer, table cell
 * or CTA url was never looked at, so it shipped broken.
 *
 * ---------------------------------------------------------------------------
 * THE RULE
 * ---------------------------------------------------------------------------
 * For every `/blog/<slug>` href anywhere in the blocks:
 *   1. slug is a published blog          -> keep, made absolute on the public site
 *   2. slug resolves to exactly one published blog once joining words are
 *      ignored (or by a decisive token overlap)  -> rewrite to the real slug
 *   3. otherwise                         -> strip the <a>, keep its text
 *
 * Step 3 stays strict on purpose: a link we cannot prove is a 404 we are
 * choosing to publish. The repair in step 2 only ever moves an href onto a slug
 * that exists, so the worst case it can produce is a link to the wrong existing
 * article — which is why it demands a *unique* and *decisive* match.
 *
 * `strip: false` turns step 3 off, leaving an unplaceable link exactly as
 * written. That is for saves a person is driving: the editor autosaves while
 * they type, and a link vanishing mid-keystroke — or pointing at an article
 * they are about to publish — is worse than a link that is briefly wrong.
 * Machine-authored content (generation, agent edits) always uses the default.
 */

const { toPublicBlogHref } = require('./publicLinks');

/** `<a ...>text</a>`, non-greedy over the text so nested markup still pairs up. */
const LINK_TAG_RE = /<a\s[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;

/** `/blog/<slug>` with or without a host, trailing slash, query or fragment. */
const BLOG_HREF_RE = /^(?:https?:\/\/[^/?#]+)?\/blog\/([^/?#]+)\/?(?:[?#].*)?$/i;

/**
 * A blog URL written as text rather than as an `<a href>`.
 *
 * The model does not always produce a link tag. It also writes the URL bare in a
 * sentence ("Read more: https://divinetalk.in/blog/…") and, in a plain-text
 * field, in markdown (`[title](https://divinetalk.in/blog/…)`). Both reach the
 * reader as something clickable, and both carry the same invented slug — so
 * checking only `<a>` tags leaves the bug fully alive. That is exactly what the
 * first version of this module did, and why the production backfill reported no
 * occurrences of a slug that was demonstrably 404ing on the live site.
 *
 * The lookbehind keeps this off attribute values (`href="…"`, `src='…'`), which
 * the `<a>` pass has already dealt with. A markdown link's `](` prefix is not
 * excluded, so those are covered too.
 *
 * Only our own hosts and root-relative paths match. Some other site's `/blog/`
 * URL is none of our business, and its slugs are not ours to "correct".
 */
const BARE_BLOG_URL_RE = new RegExp(
  '(?:' +
    // Absolute, on one of our own hosts.
    '(?<!["\'=])(https?:\\/\\/(?:[a-z0-9-]+\\.)*divinetalk\\.(?:in|live)(?::\\d+)?\\/blog\\/)' +
    '|' +
    // Root-relative. The lookbehind rejects anything that means this `/blog/`
    // is the tail of some other site's URL (`example.com/blog/…`) or an
    // attribute value the `<a>` pass already handled.
    '(?<![\\w."\'=/-])(\\/blog\\/)' +
  ')([A-Za-z0-9_-]+)',
  'gi'
);

/** Block data keys that hold a bare href rather than inline HTML. */
const HREF_KEYS = new Set(['url', 'href', 'src']);

/**
 * Words the model inserts (or drops) when it narrates a title instead of
 * copying a slug. Ignored on both sides when looking for the real slug.
 *
 * Deliberately short. Every entry here is a word that carries no topic meaning
 * in an astrology blog title, so removing it cannot make two genuinely
 * different articles look alike. Anything topical — `puja`, `date`, `2026` —
 * stays, and the uniqueness requirement below is the real guard.
 */
const JOINING_WORDS = new Set([
  'a', 'an', 'and', 'the', 'or', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'by', 'from', 'is', 'are', 'your', 'you', 'its', 'amp',
]);

/** Overlap a fuzzy candidate must reach, and the margin it needs over the runner-up. */
const MIN_TOKEN_OVERLAP = 0.8;
const MIN_OVERLAP_MARGIN = 0.1;

/**
 * Extracts the slug from an href that points at a blog page.
 *
 * @param {string} href
 * @returns {string|null} the slug, or null when the href is not an internal blog link.
 */
function blogSlugFromHref(href) {
  const match = BLOG_HREF_RE.exec(String(href ?? '').trim());
  if (!match) return null;
  try {
    // The model sometimes percent-encodes the slug it invented.
    return decodeURIComponent(match[1]).toLowerCase();
  } catch {
    return match[1].toLowerCase();
  }
}

/** Splits a slug into meaning-carrying tokens. */
function slugTokens(slug) {
  return String(slug || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== '' && !JOINING_WORDS.has(token));
}

/**
 * Canonical form used to match a written slug against a real one: the slug with
 * every joining word removed. Order is kept, because two articles whose titles
 * share the same words in a different order are genuinely different articles.
 */
function slugKey(slug) {
  return slugTokens(slug).join('-');
}

/**
 * Picks the real slug a written slug was meant to be.
 *
 * Tier 1 — exact match on the joining-word-free key. This is what fixes the
 * inserted `and`, and it is exact enough to apply without further checks.
 *
 * Tier 2 — token overlap (Jaccard), for the messier cases: a dropped word, a
 * re-ordered tail, a truncated slug. Requires both a high score and a clear
 * gap to the runner-up, so a slug that plausibly matches two articles is left
 * for the caller to strip rather than guessed at.
 *
 * @param {string} writtenSlug
 * @param {Array<{slug: string}>} candidates Published blogs.
 * @returns {string|null}
 */
function findRealSlug(writtenSlug, candidates) {
  const key = slugKey(writtenSlug);
  if (key === '') return null;

  const byKey = candidates.filter((row) => slugKey(row.slug) === key);
  if (byKey.length === 1) return byKey[0].slug;
  // Two published blogs sharing a key means the slug is ambiguous (normally a
  // `-2` duplicate). Guessing between them is worse than stripping the link.
  if (byKey.length > 1) return null;

  const written = new Set(slugTokens(writtenSlug));
  if (written.size === 0) return null;

  let best = null;
  let bestScore = 0;
  let runnerUpScore = 0;

  for (const row of candidates) {
    const other = new Set(slugTokens(row.slug));
    if (other.size === 0) continue;

    let shared = 0;
    for (const token of written) if (other.has(token)) shared += 1;
    const score = shared / (written.size + other.size - shared);

    if (score > bestScore) {
      runnerUpScore = bestScore;
      bestScore = score;
      best = row.slug;
    } else if (score > runnerUpScore) {
      runnerUpScore = score;
    }
  }

  if (bestScore >= MIN_TOKEN_OVERLAP && bestScore - runnerUpScore >= MIN_OVERLAP_MARGIN) return best;
  return null;
}

/**
 * Walks every string inside a block's data, in place.
 *
 * Recursive rather than a per-block-type field list on purpose: links turn up
 * in list items, FAQ answers, table cells and takeaways, and a block type added
 * later would silently fall out of a hand-written list — which is exactly how
 * the previous `data.html`-only check came to miss most of the article.
 *
 * @param {*} node
 * @param {(value: string, key: string|null) => string} visit
 * @param {string|null} key Property name `node` was reached through.
 * @returns {*} the replacement for `node`.
 */
function mapStrings(node, visit, key = null) {
  if (typeof node === 'string') return visit(node, key);
  if (Array.isArray(node)) return node.map((item) => mapStrings(item, visit, key));
  if (node && typeof node === 'object') {
    for (const prop of Object.keys(node)) {
      node[prop] = mapStrings(node[prop], visit, prop);
    }
  }
  return node;
}

/**
 * Collects every internal blog slug referenced anywhere in the blocks.
 *
 * @param {Array} blocks
 * @returns {Set<string>}
 */
function collectLinkedSlugs(blocks) {
  const slugs = new Set();
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block?.data || typeof block.data !== 'object') continue;
    mapStrings(block.data, (value, key) => {
      if (HREF_KEYS.has(key)) {
        const slug = blogSlugFromHref(value);
        if (slug) slugs.add(slug);
        return value;
      }
      if (value.includes('/blog/')) {
        LINK_TAG_RE.lastIndex = 0;
        let match;
        while ((match = LINK_TAG_RE.exec(value)) !== null) {
          const slug = blogSlugFromHref(match[1]);
          if (slug) slugs.add(slug);
        }
        BARE_BLOG_URL_RE.lastIndex = 0;
        while ((match = BARE_BLOG_URL_RE.exec(value)) !== null) {
          slugs.add(match[3].toLowerCase());
        }
      }
      return value;
    });
  }
  return slugs;
}

/**
 * Verifies, repairs and absolutizes every internal blog link in `blocks`.
 *
 * Mutates `blocks` in place, the same as the check it replaces, so callers that
 * already hold the array keep working.
 *
 * Best-effort by contract: if the lookup fails, the blocks are returned
 * untouched rather than having every internal link stripped. A database blip
 * must not quietly strip an article's links.
 *
 * @param {Array} blocks
 * @param {object} [options]
 * @param {boolean} [options.strip=true] Remove an `<a>` whose destination could
 *   not be placed. False leaves it as written — see the file header.
 * @returns {Promise<{checked: number, repaired: Array<{from: string, to: string}>, stripped: string[], kept: string[]}>}
 */
async function repairInternalLinks(blocks, { strip = true } = {}) {
  const result = { checked: 0, repaired: [], stripped: [], kept: [] };
  if (!Array.isArray(blocks) || blocks.length === 0) return result;

  const writtenSlugs = collectLinkedSlugs(blocks);
  result.checked = writtenSlugs.size;
  if (writtenSlugs.size === 0) return result;

  // Required lazily: this service is reached from the model layer's own callers
  // and a top-level require would close an import cycle through models/index.js.
  const { Op } = require('sequelize');
  const { Blog } = require('../models');

  const valid = new Set();
  const unresolved = [];
  let candidates = [];

  const validRows = await Blog.scope('linkable').findAll({
    where: { slug: { [Op.in]: Array.from(writtenSlugs) } },
    attributes: ['slug'],
    raw: true,
  });
  for (const row of validRows) valid.add(row.slug);
  for (const slug of writtenSlugs) if (!valid.has(slug)) unresolved.push(slug);

  // Only pay for the full slug list when something actually needs repairing.
  if (unresolved.length > 0) {
    candidates = await Blog.scope('linkable').findAll({
      attributes: ['slug'],
      raw: true,
    });
  }

  /** written slug -> real slug, for the ones we could place. */
  const repairs = new Map();
  for (const slug of unresolved) {
    const real = findRealSlug(slug, candidates);
    if (real) {
      repairs.set(slug, real);
      result.repaired.push({ from: slug, to: real });
    } else if (strip) {
      result.stripped.push(slug);
    } else {
      result.kept.push(slug);
    }
  }

  /** Decides what an href pointing at `slug` should become. */
  const resolveHref = (href) => {
    const slug = blogSlugFromHref(href);
    if (!slug) return href; // external link, mailto, anchor — untouched
    if (valid.has(slug)) return toPublicBlogHref(href);
    const real = repairs.get(slug);
    if (!real) return strip ? null : href; // null tells the caller to strip
    return toPublicBlogHref(href.replace(/\/blog\/[^/?#]+/i, `/blog/${real}`));
  };

  for (const block of blocks) {
    if (!block?.data || typeof block.data !== 'object') continue;

    mapStrings(block.data, (value, key) => {
      // A bare href field (cta_button, embed, image). There is no link text to
      // fall back to here, so an unrepairable one is left exactly as written
      // rather than blanking the field and deleting the whole block on render.
      if (HREF_KEYS.has(key)) {
        const resolved = resolveHref(value);
        return resolved === null ? value : resolved;
      }

      if (!value.includes('/blog/')) return value;

      const withTagsFixed = value.replace(LINK_TAG_RE, (fullMatch, href, linkText) => {
        const slug = blogSlugFromHref(href);
        if (!slug) return fullMatch;
        const resolved = resolveHref(href);
        if (resolved === null) return linkText; // strip the tag, keep the words
        return fullMatch.replace(href, resolved);
      });

      // A URL written as text. Only the slug is rewritten, never removed: this
      // is prose the reader sees, so deleting it would cut a sentence in half.
      // An unplaceable one is reported by the caller and left alone.
      return withTagsFixed.replace(
        BARE_BLOG_URL_RE,
        (fullMatch, hostPrefix, relativePrefix, slug) => {
          const real = repairs.get(slug.toLowerCase());
          return real ? `${hostPrefix || relativePrefix}${real}` : fullMatch;
        }
      );
    });
  }

  return result;
}

/**
 * The same repair, for a blog that has no `content_blocks` at all.
 *
 * Rows that predate the block editor hold their article only as `blog_content`
 * HTML. They are still delivered to the client and still carry internal links,
 * so they need the same treatment — but there are no blocks to walk.
 *
 * Implemented by wrapping the HTML in a throwaway block rather than by a second
 * copy of the traversal: one set of rules, one place to change them.
 *
 * @param {string} html
 * @param {object} [options] Same options as `repairInternalLinks`.
 * @returns {Promise<{html: string, outcome: object}>}
 */
async function repairInternalLinksInHtml(html, options) {
  const blocks = [{ type: 'paragraph', data: { html: String(html ?? '') } }];
  const outcome = await repairInternalLinks(blocks, options);
  return { html: blocks[0].data.html, outcome };
}

module.exports = {
  repairInternalLinks,
  repairInternalLinksInHtml,
  findRealSlug,
  blogSlugFromHref,
  slugKey,
  JOINING_WORDS,
};
