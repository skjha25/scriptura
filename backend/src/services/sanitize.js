'use strict';

/**
 * HTML sanitisation.
 *
 * Threat model: article text is written by an LLM from a prompt that includes
 * user-supplied topic/keyword strings and, when web grounding is on, scraped
 * third-party page content. All three are untrusted. Any of them could induce
 * the model to emit `<script>`, an `onerror=` attribute, or a `javascript:` URL,
 * which would become stored XSS the moment `blog_content` is rendered on the
 * public site.
 *
 * So: sanitise on the way IN (before persisting), not just on the way out. A
 * stored payload is dangerous to every consumer of the table, including the ones
 * that are not this application.
 *
 * The allow-list is intentionally narrow — exactly the tags blocksToHtml emits,
 * plus the inline formatting the editor offers.
 */

const sanitizeHtml = require('sanitize-html');

/** Inline tags permitted inside paragraph/heading/cell text. */
const INLINE_TAGS = ['strong', 'b', 'em', 'i', 'u', 's', 'code', 'a', 'br', 'span', 'sup', 'sub'];

/** Block tags blocksToHtml is allowed to produce. */
const BLOCK_TAGS = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote', 'cite',
  'figure', 'figcaption', 'img',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption',
  'section', 'div', 'details', 'summary',
  'hr', 'iframe',
];

/**
 * Class names we allow through. Restricting to a known list stops an injected
 * `class` from being used to impersonate site chrome or hide content, while
 * still permitting the presentational classes the renderer and the existing
 * production content rely on (e.g. `<p class="lead">`).
 */
const ALLOWED_CLASSES = [
  'lead',
  'scriptura-figure', 'scriptura-figcaption', 'scriptura-image',
  'scriptura-quote', 'scriptura-quote-attribution',
  'scriptura-table-wrap', 'scriptura-table', 'scriptura-table-caption',
  'scriptura-faq', 'scriptura-faq-item', 'scriptura-faq-question', 'scriptura-faq-answer',
  'scriptura-cta', 'scriptura-cta-button',
  'scriptura-takeaway', 'scriptura-takeaway-title', 'scriptura-takeaway-list',
  'scriptura-embed', 'scriptura-embed-frame',
  'scriptura-list', 'scriptura-list-bullet', 'scriptura-list-numbered',
];

const baseOptions = {
  allowedTags: [...BLOCK_TAGS, ...INLINE_TAGS],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
    iframe: ['src', 'title', 'width', 'height', 'allow', 'allowfullscreen', 'loading'],
    th: ['scope', 'colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
    '*': ['class', 'id'],
  },
  // Anything not listed here is stripped, which kills `javascript:`,
  // `data:text/html`, and `vbscript:` URLs.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  // `data:` images are permitted nowhere: an inline data URL is a common way to
  // smuggle an SVG containing script.
  allowedSchemesByTag: {
    img: ['http', 'https'],
    iframe: ['https'],
    a: ['http', 'https', 'mailto', 'tel'],
  },
  allowProtocolRelative: false,
  // Drop the *content* of these, not just the tags — otherwise a stripped
  // <script> leaves its source code behind as visible text.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
  enforceHtmlBoundary: true,

  transformTags: {
    /**
     * Any external link gets rel="noopener noreferrer". Without noopener, a
     * target=_blank link hands the opened page a reference to ours via
     * window.opener. Internal links (relative, or same-origin) are left alone so
     * internal linking does not get spurious attributes.
     */
    a(tagName, attribs) {
      const href = attribs.href || '';
      const isExternal = /^https?:\/\//i.test(href);
      const next = { ...attribs };
      if (isExternal) {
        next.rel = 'noopener noreferrer';
        if (!next.target) next.target = '_blank';
      } else {
        delete next.target;
        delete next.rel;
      }
      return { tagName: 'a', attribs: next };
    },
    /** Images are always lazy and async-decoded; cheap win, applied centrally. */
    img(tagName, attribs) {
      return {
        tagName: 'img',
        attribs: { ...attribs, loading: 'lazy', decoding: 'async' },
      };
    },
  },

  /**
   * Filters `class` down to the allow-list rather than dropping the attribute
   * wholesale, so legitimate renderer classes survive and injected ones do not.
   */
  allowedClasses: { '*': ALLOWED_CLASSES },
};

/**
 * Sanitises a full article HTML document fragment.
 * @param {string} html
 * @returns {string} Safe HTML, or '' for non-string input.
 */
function sanitizeArticleHtml(html) {
  if (typeof html !== 'string' || html === '') return '';
  return sanitizeHtml(html, baseOptions);
}

/**
 * Sanitises a short inline fragment — a heading, a table cell, a paragraph's
 * text. Block-level tags are stripped here so a paragraph cannot contain a
 * table and break the block model's structure.
 * @param {string} html
 * @returns {string}
 */
function sanitizeInline(html) {
  if (typeof html !== 'string' || html === '') return '';
  return sanitizeHtml(html, {
    ...baseOptions,
    allowedTags: INLINE_TAGS,
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      '*': ['class'],
    },
  });
}

/** Block-level boundaries that should become a space when flattening to text. */
const BLOCK_BOUNDARY_RE =
  /<\/?(?:p|h[1-6]|li|ul|ol|div|section|tr|td|th|blockquote|figcaption|figure|summary|details|caption|table|thead|tbody|br|hr)\b[^>]*>/gi;

/**
 * Strips every tag, yielding plain text. Used for meta descriptions, word
 * counts, and SEO scoring, where markup would corrupt the measurement.
 *
 * Block tags are replaced with a space *before* stripping, so `</p><p>` does not
 * weld the last word of one paragraph onto the first word of the next and
 * quietly undercount every article.
 *
 * @param {string} html
 * @returns {string} Decoded plain text with collapsed whitespace.
 */
function toPlainText(html) {
  if (typeof html !== 'string' || html === '') return '';

  const spaced = html.replace(BLOCK_BOUNDARY_RE, ' ');

  const stripped = sanitizeHtml(spaced, {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
  });

  return stripped
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // `&amp;` is decoded last so `&amp;lt;` does not turn into `<`.
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Escapes text for safe interpolation into HTML we are building ourselves.
 * Used by blocksToHtml for values that must never contain markup (URLs in
 * attributes, alt text, CTA labels).
 * @param {*} value
 * @returns {string}
 */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Highest code point treated as unsafe whitespace/control input in a URL. */
const URL_MIN_SAFE_CODE = 0x20; // space
const URL_DEL_CODE = 0x7f; // DEL

/**
 * True if the string contains any control character, space, or DEL.
 *
 * Attackers insert these to split a scheme so a naive prefix check misses it —
 * a NUL or newline between "java" and "script:" is the classic form. Written as
 * an explicit code-point scan rather than a regex so the source carries no raw
 * control bytes (which make the file unreadable to git and ESLint) and no
 * fragile escape sequences.
 *
 * @param {string} value
 * @returns {boolean}
 */
function hasUnsafeUrlChars(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= URL_MIN_SAFE_CODE || code === URL_DEL_CODE) return true;
  }
  return false;
}

/**
 * Validates a URL for use in an href/src we emit.
 *
 * Returns '' for anything that is not an http(s) URL, a root-relative path, a
 * storage-relative path, or a mailto/tel link — so a `javascript:` payload
 * becomes an empty attribute rather than a live handler.
 *
 * @param {string} url
 * @returns {string} The URL, or '' if it is not safe to emit.
 */
function safeUrl(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (trimmed === '') return '';
  if (hasUnsafeUrlChars(trimmed)) return '';

  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(?:mailto|tel):/i.test(trimmed)) return trimmed;

  // Protocol-relative (`//evil.com`) escapes our origin — reject before the
  // root-relative check, which would otherwise accept it.
  if (trimmed.startsWith('//')) return '';
  if (trimmed.startsWith('/')) return trimmed;

  // A bare storage-relative path such as `blogs/July2026/x.png`. The colon test
  // rejects anything carrying a scheme we did not explicitly allow above.
  if (/^[a-z0-9._~-]/i.test(trimmed) && !trimmed.includes(':')) return trimmed;

  return '';
}

module.exports = {
  sanitizeArticleHtml,
  sanitizeInline,
  toPlainText,
  escapeHtml,
  safeUrl,
  hasUnsafeUrlChars,
  ALLOWED_CLASSES,
  INLINE_TAGS,
  BLOCK_TAGS,
};
