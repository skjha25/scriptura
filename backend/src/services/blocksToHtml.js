'use strict';

/**
 * The canonical `content_blocks` -> HTML renderer.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * `content_blocks` is what the editor mutates; `blog_content` is the rendered
 * HTML the public site (and other existing consumers of the `blogs` table) read.
 * The spec requires the two never drift, so `blog_content` is regenerated from
 * `content_blocks` on every single save rather than being separately editable.
 *
 * ---------------------------------------------------------------------------
 * PARITY WITH THE FRONTEND
 * ---------------------------------------------------------------------------
 * The editor's live preview and the public blog page must render identically, and
 * both are served by ONE React component —
 * frontend/src/components/BlockRenderer.js. There is no JavaScript mirror of this
 * module; the frontend renders React elements from the same blocks rather than
 * re-deriving an HTML string.
 *
 * This module remains canonical for `blog_content`, which exists for consumers
 * outside this app (the existing Divinetalk site, crawlers). Cross-language parity
 * is enforced against shared/block-fixtures.json, generated from THIS file:
 *
 *   backend   tests/unit/blocksToHtml.test.js            — exact string match
 *   frontend  src/components/__tests__/blockRenderer.parity.test.js — DOM match
 *
 * If you change markup here, change BlockRenderer.js to match and regenerate the
 * fixtures (`node scripts/generate-block-fixtures.js`). A failure in either suite
 * is the drift alarm — do not silence it.
 *
 * ---------------------------------------------------------------------------
 * OUTPUT CONVENTIONS
 * ---------------------------------------------------------------------------
 * Markup follows the existing production content style so new articles sit
 * alongside old ones without restyling: a leading `<p class="lead">`, `<h2>`
 * section headings, plain `<ul>/<li>` lists, `<a>` links. Everything else
 * carries a `scriptura-` prefixed class so the public stylesheet can target it.
 *
 * All output is escaped/sanitised here. Callers must not re-escape.
 */

const { escapeHtml, safeUrl, sanitizeInline, sanitizeArticleHtml } = require('./sanitize');
const { BLOCK_TYPES } = require('../constants');

/** Heading levels a block may request. h1 is reserved for the page title. */
const MIN_HEADING_LEVEL = 2;
const MAX_HEADING_LEVEL = 4;

/** Renders an optional `class="..."` attribute. */
function classAttr(className) {
  return className ? ` class="${escapeHtml(className)}"` : '';
}

/**
 * Coerces block text to a safe inline HTML string.
 * Accepts either `data.html` (rich inline markup from the editor) or
 * `data.text` (plain text), preferring the former.
 */
function inlineContent(data) {
  if (typeof data.html === 'string' && data.html.trim() !== '') {
    return sanitizeInline(data.html);
  }
  if (typeof data.text === 'string') {
    // Plain text: escape it, then honour explicit newlines as <br> so a
    // multi-line paragraph typed in the editor survives the round trip.
    return escapeHtml(data.text).replace(/\r?\n/g, '<br />');
  }
  return '';
}

/** Clamps a heading level into the allowed range. */
function headingLevel(value) {
  const level = Number.parseInt(value, 10);
  if (!Number.isFinite(level)) return MIN_HEADING_LEVEL;
  return Math.min(MAX_HEADING_LEVEL, Math.max(MIN_HEADING_LEVEL, level));
}

// ---------------------------------------------------------------------------
// Per-block renderers. Each returns an HTML string, or '' to omit the block
// entirely (an empty block should leave no trace in the output).
// ---------------------------------------------------------------------------

const renderers = {
  heading(data) {
    const content = inlineContent(data);
    if (content === '') return '';
    const level = headingLevel(data.level);
    return `<h${level}>${content}</h${level}>`;
  },

  paragraph(data) {
    const content = inlineContent(data);
    if (content === '') return '';
    // `lead` reproduces the existing production convention of a styled opening
    // paragraph (see the sample row's `<p class="lead">`).
    return `<p${classAttr(data.is_lead ? 'lead' : '')}>${content}</p>`;
  },

  image(data) {
    const src = safeUrl(data.url || data.src || '');
    if (src === '') return '';
    // Alt text is an accessibility requirement and an SEO signal. An empty alt
    // is valid HTML for decorative images, so we emit alt="" rather than
    // omitting the attribute.
    const alt = escapeHtml(data.alt_text || data.alt || '');
    const caption = inlineContent({ text: data.caption });
    const img = `<img${classAttr('scriptura-image')} src="${escapeHtml(src)}" alt="${alt}" />`;
    if (caption === '') {
      return `<figure${classAttr('scriptura-figure')}>${img}</figure>`;
    }
    return (
      `<figure${classAttr('scriptura-figure')}>${img}` +
      `<figcaption${classAttr('scriptura-figcaption')}>${caption}</figcaption></figure>`
    );
  },

  quote(data) {
    const content = inlineContent(data);
    if (content === '') return '';
    const attribution = escapeHtml(data.attribution || '');
    const cite = attribution
      ? `<cite${classAttr('scriptura-quote-attribution')}>${attribution}</cite>`
      : '';
    return `<blockquote${classAttr('scriptura-quote')}><p>${content}</p>${cite}</blockquote>`;
  },

  table(data) {
    const headers = Array.isArray(data.headers) ? data.headers : [];
    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (headers.length === 0 && rows.length === 0) return '';

    const caption = escapeHtml(data.caption || '');
    const captionHtml = caption
      ? `<caption${classAttr('scriptura-table-caption')}>${caption}</caption>`
      : '';

    // scope="col" is what lets a screen reader associate each cell with its
    // column header.
    const thead = headers.length
      ? `<thead><tr>${headers
          .map((h) => `<th scope="col">${sanitizeInline(String(h ?? ''))}</th>`)
          .join('')}</tr></thead>`
      : '';

    const tbody = rows.length
      ? `<tbody>${rows
          .map((row) => {
            const cells = Array.isArray(row) ? row : [row];
            return `<tr>${cells
              .map((c) => `<td>${sanitizeInline(String(c ?? ''))}</td>`)
              .join('')}</tr>`;
          })
          .join('')}</tbody>`
      : '';

    // The wrapper div is what allows a wide table to scroll horizontally on
    // mobile instead of forcing the whole page wider.
    return (
      `<div${classAttr('scriptura-table-wrap')}>` +
      `<table${classAttr('scriptura-table')}>${captionHtml}${thead}${tbody}</table></div>`
    );
  },

  faq_accordion(data) {
    const items = (Array.isArray(data.items) ? data.items : []).filter(
      (item) => item && (item.question || item.answer)
    );
    if (items.length === 0) return '';

    // Plain question-then-answer, always visible. This was a <details>/<summary>
    // accordion, which worked but read as a widget bolted onto the article: on
    // the live post every answer sat collapsed behind a disclosure triangle, so
    // the section looked empty and out of place next to the surrounding prose.
    // Open text costs nothing here — the answers are two or three sentences —
    // and an <h3> question is a real heading for crawlers rather than a
    // <summary> they have to be trusted to expand.
    const rendered = items
      .map((item) => {
        const q = inlineContent({ text: item.question, html: item.question_html });
        const a = inlineContent({ text: item.answer, html: item.answer_html });
        return (
          `<div${classAttr('scriptura-faq-item')}>` +
          `<h3${classAttr('scriptura-faq-question')}>${q}</h3>` +
          `<div${classAttr('scriptura-faq-answer')}>${a}</div></div>`
        );
      })
      .join('');

    return `<section${classAttr('scriptura-faq')}>${rendered}</section>`;
  },

  cta_button(data) {
    const href = safeUrl(data.url || data.href || '');
    const label = escapeHtml(data.text || data.label || '');
    if (href === '' || label === '') return '';
    return (
      `<div${classAttr('scriptura-cta')}>` +
      `<a${classAttr('scriptura-cta-button')} href="${escapeHtml(href)}">${label}</a></div>`
    );
  },

  list(data) {
    const items = (Array.isArray(data.items) ? data.items : []).filter(
      (item) => item !== null && item !== undefined && String(item).trim() !== ''
    );
    if (items.length === 0) return '';
    const ordered = data.style === 'numbered' || data.ordered === true;
    const tag = ordered ? 'ol' : 'ul';
    const className = `scriptura-list ${ordered ? 'scriptura-list-numbered' : 'scriptura-list-bullet'}`;
    const li = items.map((item) => `<li>${sanitizeInline(String(item))}</li>`).join('');
    return `<${tag}${classAttr(className)}>${li}</${tag}>`;
  },

  embed(data) {
    const src = safeUrl(data.url || data.src || '');
    if (src === '') return '';
    const title = escapeHtml(data.title || 'Embedded content');
    // Only https iframes survive sanitisation (see allowedSchemesByTag). For
    // anything else we degrade to a plain link rather than dropping the block,
    // so the author does not silently lose content.
    if (!/^https:\/\//i.test(src)) {
      return `<p${classAttr('scriptura-embed')}><a href="${escapeHtml(src)}">${title}</a></p>`;
    }
    return (
      `<div${classAttr('scriptura-embed')}>` +
      `<iframe${classAttr('scriptura-embed-frame')} src="${escapeHtml(src)}" ` +
      `title="${title}" loading="lazy" allowfullscreen></iframe></div>`
    );
  },

  key_takeaway(data) {
    const items = (Array.isArray(data.items) ? data.items : []).filter(
      (item) => item !== null && item !== undefined && String(item).trim() !== ''
    );
    const title = escapeHtml(data.title || 'Key takeaways');
    const body = inlineContent(data);
    if (items.length === 0 && body === '') return '';

    const list = items.length
      ? `<ul${classAttr('scriptura-takeaway-list')}>${items
          .map((item) => `<li>${sanitizeInline(String(item))}</li>`)
          .join('')}</ul>`
      : '';
    const paragraph = body ? `<p>${body}</p>` : '';

    return (
      `<section${classAttr('scriptura-takeaway')}>` +
      `<h3${classAttr('scriptura-takeaway-title')}>${title}</h3>${paragraph}${list}</section>`
    );
  },
};

/**
 * Renders one block. Unknown types are skipped rather than thrown on: a block
 * type added by a newer frontend should degrade to "not shown", never take down
 * the whole article render.
 *
 * @param {{type: string, data: object}} block
 * @returns {string}
 */
function renderBlock(block) {
  if (!block || typeof block !== 'object') return '';

  // Everything, including the property reads, sits inside the try. Reading
  // `block.type` or `block.data` can itself throw — a throwing getter, a
  // revoked Proxy, an exotic object from a JSON reviver — and the guarantee this
  // function makes is that no single block can fail the whole article render.
  // Leaving the reads outside the try would have quietly broken that.
  try {
    const renderer = renderers[block.type];
    if (!renderer) return '';
    const data = block.data && typeof block.data === 'object' ? block.data : {};
    return renderer(data);
  } catch {
    return '';
  }
}

/**
 * Renders an ordered block list to the article HTML stored in `blog_content`.
 *
 * @param {Array<{id?: string, type: string, data: object}>} blocks
 * @returns {string} Sanitised HTML. '' when there is nothing to render.
 */
function blocksToHtml(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return '';

  const html = blocks.map(renderBlock).filter((part) => part !== '').join('');
  if (html === '') return '';

  // Belt and braces: every renderer already escapes or sanitises its inputs,
  // but running the assembled document through the article sanitiser once more
  // means a future renderer that forgets cannot introduce stored XSS.
  return sanitizeArticleHtml(html);
}

/**
 * Extracts plain text from blocks for word counting and SEO scoring.
 *
 * Works from the blocks rather than the rendered HTML so that non-prose chrome
 * (CTA labels, table markup, embed titles) does not inflate the count, while
 * genuine prose in headings, lists and FAQ answers still counts.
 *
 * @param {Array} blocks
 * @returns {string}
 */
function blocksToPlainText(blocks) {
  if (!Array.isArray(blocks)) return '';

  const parts = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    // Same reasoning as renderBlock: a single hostile block must not be able to
    // break word counting or SEO scoring for the whole article.
    try {
      collectBlockText(block, parts);
    } catch {
      // Skip this block's text and keep going.
    }
  }

  const { toPlainText } = require('./sanitize');
  return toPlainText(parts.filter(Boolean).join(' '));
}

/**
 * Appends one block's prose to `parts`. Split out of blocksToPlainText so the
 * per-block error boundary there stays readable.
 *
 * @param {object} block
 * @param {string[]} parts Mutated in place.
 */
function collectBlockText(block, parts) {
  const data = block.data && typeof block.data === 'object' ? block.data : {};

  switch (block.type) {
    case 'heading':
    case 'paragraph':
    case 'quote':
      parts.push(data.text || data.html || '');
      break;
    case 'list':
    case 'key_takeaway':
      if (data.title) parts.push(data.title);
      if (data.text) parts.push(data.text);
      if (Array.isArray(data.items)) parts.push(data.items.join(' '));
      break;
    case 'faq_accordion':
      if (Array.isArray(data.items)) {
        for (const item of data.items) {
          if (!item) continue;
          parts.push(`${item.question || ''} ${item.answer || ''}`);
        }
      }
      break;
    case 'table':
      if (Array.isArray(data.headers)) parts.push(data.headers.join(' '));
      if (Array.isArray(data.rows)) {
        for (const row of data.rows) {
          parts.push((Array.isArray(row) ? row : [row]).join(' '));
        }
      }
      break;
    case 'image':
      // The caption is prose the reader sees; alt text is not.
      if (data.caption) parts.push(data.caption);
      break;
    // cta_button and embed contribute no article prose.
    default:
      break;
  }
}

/**
 * Counts words in a block list. Used for `word_count` and SEO scoring.
 * @param {Array} blocks
 * @returns {number}
 */
function countWords(blocks) {
  const text = blocksToPlainText(blocks);
  if (text === '') return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

module.exports = {
  blocksToHtml,
  blocksToPlainText,
  countWords,
  renderBlock,
  BLOCK_TYPES,
  MIN_HEADING_LEVEL,
  MAX_HEADING_LEVEL,
};
