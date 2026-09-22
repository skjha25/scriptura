// frontend/src/lib/sanitizeInline.js
/**
 * Inline HTML sanitiser for the browser.
 *
 * WHY THIS EXISTS AT ALL
 * React escapes text by default, so 99% of block content is safe for free. The
 * exception is inline rich text: a paragraph's `data.html` carries author
 * formatting (`<strong>`, `<em>`, links) and must be injected with
 * `dangerouslySetInnerHTML` to render. That is the one place a stored payload
 * could execute, so it is sanitised first.
 *
 * WHY NOT DOMPurify
 * The allow-list needed here is tiny — six formatting tags and a guarded `href`.
 * A DOM-based walk over a detached `<template>` is ~60 lines with no dependency
 * and no bundle cost, and it is exactly auditable. If the requirement ever grows
 * beyond inline formatting, swap this for DOMPurify rather than extending it.
 *
 * The backend sanitises the same content on write (see
 * backend/src/services/sanitize.js), so this is the second of two layers. It is
 * still worth having: it defends content that predates the backend's sanitiser
 * and anything written directly to the table by another system.
 */

/** Inline tags an author may use. Anything else is unwrapped to its text. */
const ALLOWED_TAGS = new Set(['STRONG', 'B', 'EM', 'I', 'U', 'S', 'CODE', 'A', 'BR', 'SPAN', 'SUP', 'SUB']);

/** Attributes permitted per tag. Everything else is dropped. */
const ALLOWED_ATTRS = { A: new Set(['href', 'title']) };

/**
 * Tags whose CONTENT is discarded along with the tag, rather than unwrapped.
 *
 * The default treatment for a disallowed element is to unwrap it — keep the text,
 * drop the markup — which is right for layout tags: `<div>hello</div>` should
 * still read "hello". It is wrong for these, because their content is code, not
 * prose. Unwrapping `<script>alert(1)</script>` leaves the literal text
 * "alert(1)" sitting in the article, which is both nonsense to a reader and a
 * silent hint that a payload got through.
 *
 * Mirrors `nonTextTags` in backend/src/services/sanitize.js — the two sanitisers
 * must agree, and the fixture parity test fails if they do not.
 */
const DROP_CONTENT_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'OPTION', 'NOSCRIPT']);

/** Public site that serves `/blog/<slug>`. */
const PUBLIC_SITE_URL = 'https://divinetalk.in';

/** Rewrites an internal blog href (relative, or on a divinetalk.live host) to the public site. */
function toPublicBlogHref(href) {
  const value = String(href).trim();
  if (/^\/blog\//i.test(value)) return `${PUBLIC_SITE_URL}${value}`;
  const absolute = /^https?:\/\/([^/?#]+)(\/blog\/.*)$/i.exec(value);
  if (absolute && /(^|\.)divinetalk\.live$/i.test(absolute[1])) return `${PUBLIC_SITE_URL}${absolute[2]}`;
  return href;
}

/** URL schemes safe to put in an href. */
const SAFE_SCHEME = /^(?:https?:|mailto:|tel:)/i;

/**
 * True if a URL is safe to emit.
 * Rejects `javascript:`, `data:`, and control-character-split schemes.
 */
function isSafeHref(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed === '') return false;
  // Control characters and whitespace are used to split a scheme so a naive
  // prefix check misses it ("java\0script:").
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return false;
  }
  if (SAFE_SCHEME.test(trimmed)) return true;
  // Relative and root-relative links are fine; protocol-relative is not, since
  // it escapes the origin.
  if (trimmed.startsWith('//')) return false;
  return !trimmed.includes(':');
}

/**
 * Recursively strips a node tree down to the allow-list.
 * Disallowed elements are replaced by their own children, so text survives while
 * markup does not.
 */
function scrub(node) {
  const children = Array.from(node.childNodes);

  for (const child of children) {
    if (child.nodeType === Node.TEXT_NODE) continue;

    if (child.nodeType !== Node.ELEMENT_NODE) {
      // Comments, CDATA, processing instructions — no reason to keep any.
      child.remove();
      continue;
    }

    // Checked before recursing: there is no point cleaning a subtree that is
    // about to be discarded whole.
    if (DROP_CONTENT_TAGS.has(child.tagName)) {
      child.remove();
      continue;
    }

    // Recurse first, so an allowed element nested inside a disallowed one is
    // still cleaned before it is hoisted.
    scrub(child);

    if (!ALLOWED_TAGS.has(child.tagName)) {
      // Unwrap: keep the text, discard the element.
      child.replaceWith(...Array.from(child.childNodes));
      continue;
    }

    const permitted = ALLOWED_ATTRS[child.tagName] || new Set();
    for (const attr of Array.from(child.attributes)) {
      const name = attr.name.toLowerCase();
      if (!permitted.has(name)) {
        // Catches every `on*` handler, `style`, `srcdoc`, and anything novel.
        child.removeAttribute(attr.name);
        continue;
      }
      if (name === 'href' && !isSafeHref(attr.value)) {
        child.removeAttribute(attr.name);
      }
    }

    // External links get noopener: without it, a target=_blank link hands the
    // opened page a reference to ours via window.opener.
    if (child.tagName === 'A') {
      // Internal blog links point at the public site; a root-relative /blog/
      // href would resolve to this app's host, which serves no blog pages.
      // Mirrors backend/src/services/publicLinks.js.
      const rawHref = child.getAttribute('href');
      if (rawHref) child.setAttribute('href', toPublicBlogHref(rawHref));
      const href = child.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) {
        child.setAttribute('rel', 'noopener noreferrer');
        child.setAttribute('target', '_blank');
      }
    }
  }
}

/**
 * Sanitises an inline HTML fragment.
 *
 * A `<template>` is used as the parsing container because its contents are inert:
 * scripts do not execute and `<img src=x onerror=…>` does not fire a request,
 * even before we strip it.
 *
 * @param {string} html
 * @returns {string} Safe inline HTML, or '' for non-string input.
 */
export function sanitizeInline(html) {
  if (typeof html !== 'string' || html === '') return '';

  // No DOM (server-side render, or a non-jsdom test env): fall back to escaping
  // everything rather than returning markup we could not inspect.
  if (typeof document === 'undefined') return escapeHtml(html);

  const template = document.createElement('template');
  template.innerHTML = html;
  scrub(template.content);
  return template.innerHTML;
}

/**
 * Escapes text for literal display.
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validates a URL for an href/src the renderer emits.
 * Mirrors `safeUrl` in the backend sanitiser.
 * @param {string} url
 * @returns {string} The URL, or '' when unsafe.
 */
export function safeUrl(url) {
  return isSafeHref(url) ? url.trim() : '';
}

export default sanitizeInline;
