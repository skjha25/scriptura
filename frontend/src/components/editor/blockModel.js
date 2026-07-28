// frontend/src/components/editor/blockModel.js
/**
 * Block identity, creation and text projection.
 *
 * WHY THIS EXISTS
 * `content_blocks` is a plain JSON array, so every operation the editor performs
 * on it — insert, duplicate, retitle, reorder — is pure data manipulation. Keeping
 * that logic out of the components means the canvas, the settings panels and the
 * tests all agree on what a "new heading block" is, and there is exactly one place
 * that decides how an id is minted.
 *
 * The default shapes below mirror backend/src/services/blocksToHtml.js, which is
 * the authority on what each type reads. A default that the renderer ignores is a
 * field the author can never see the effect of, so there are none.
 */

import { BLOCK_TYPE_META } from '../../lib/constants';

/**
 * Fallback id counter.
 *
 * Only reached where `crypto.randomUUID` is unavailable (older Safari, a non-secure
 * origin on some browsers, a bare test environment). It is per-session, which is
 * all that is needed: ids only have to be unique within one blocks array, and the
 * backend accepts any string up to 64 characters.
 */
let fallbackCounter = 0;

/** @returns {string} A stable id for a block. */
function newBlockId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  fallbackCounter += 1;
  return `blk-${Date.now().toString(36)}-${fallbackCounter}`;
}

/**
 * Default `data` per block type, as a factory rather than a frozen literal —
 * returning a shared object would let two blocks alias the same `items` array,
 * and editing one would silently edit the other.
 */
const DEFAULT_DATA = {
  heading: () => ({ level: 2, text: '' }),
  paragraph: () => ({ text: '', is_lead: false }),
  image: () => ({
    url: '',
    alt_text: '',
    caption: '',
    has_logo_overlay: false,
    logo_position: 'none',
  }),
  quote: () => ({ text: '', attribution: '' }),
  // Two columns and two rows: an empty table with no cells gives the author
  // nothing to click, and the renderer omits a table with no headers or rows.
  table: () => ({ caption: '', headers: ['Column 1', 'Column 2'], rows: [['', ''], ['', '']] }),
  faq_accordion: () => ({ items: [{ question: '', answer: '' }] }),
  cta_button: () => ({ text: '', url: '' }),
  list: () => ({ style: 'bullet', items: [''] }),
  embed: () => ({ url: '', title: '' }),
  key_takeaway: () => ({ title: 'Key takeaways', items: [''] }),
};

/**
 * Creates a block of `type` with sensible defaults.
 * @param {string} type One of BLOCK_TYPES.
 * @returns {{id: string, type: string, data: object}}
 */
export function createBlock(type) {
  const factory = DEFAULT_DATA[type];
  return { id: newBlockId(), type, data: factory ? factory() : {} };
}

/**
 * Deep-clones block data.
 *
 * A JSON round trip is exactly right here rather than lazy: `data` is persisted as
 * JSON, so anything it can legitimately hold survives the trip, and anything that
 * does not survive had no business being there.
 */
function cloneData(data) {
  if (!data || typeof data !== 'object') return {};
  return JSON.parse(JSON.stringify(data));
}

/**
 * Copies a block under a fresh id.
 * @param {{type: string, data: object}} block
 */
export function duplicateBlock(block) {
  return { id: newBlockId(), type: block.type, data: cloneData(block.data) };
}

/**
 * Normalises a loaded blocks array: guarantees an id on every block and an object
 * `data`.
 *
 * Rows written before the editor existed (or by another system against the shared
 * `blogs` table) can have neither. Minting ids at load rather than at render is
 * what keeps React keys stable across a re-render.
 *
 * @param {Array|null|undefined} blocks
 * @returns {Array<{id: string, type: string, data: object}>}
 */
export function withBlockIds(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .filter((block) => block && typeof block === 'object' && typeof block.type === 'string')
    .map((block) => ({
      id: typeof block.id === 'string' && block.id !== '' ? block.id : newBlockId(),
      type: block.type,
      data: block.data && typeof block.data === 'object' ? block.data : {},
    }));
}

/** Human label for a block type, falling back to the raw type for unknown ones. */
export function blockTypeLabel(type) {
  return BLOCK_TYPE_META[type]?.label || type;
}

/** Icon glyph for a block type. Decorative — always paired with the label. */
export function blockTypeIcon(type) {
  return BLOCK_TYPE_META[type]?.icon || '◆';
}

/**
 * Strips markup from an inline HTML fragment.
 *
 * A `<template>` is used because its contents are inert — nothing loads or
 * executes while we read `textContent` off it.
 */
function stripTags(html) {
  if (typeof document === 'undefined') return html.replace(/<[^>]*>/g, '');
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.textContent || '';
}

/**
 * The editable plain-text projection of a block's text.
 *
 * A block generated by the model may carry `data.html` (inline `<strong>`, links)
 * instead of `data.text`. The canvas edits plain text, so the projection is what
 * is shown; `setBlockText` below is what makes an edit to it lossless-or-explicit.
 *
 * @param {object} data
 * @returns {string}
 */
export function plainTextOf(data) {
  if (typeof data?.text === 'string') return data.text;
  if (typeof data?.html === 'string' && data.html !== '') return stripTags(data.html);
  return '';
}

/** True when a block's text is stored as inline HTML rather than plain text. */
export function isRichText(data) {
  return typeof data?.html === 'string' && data.html.trim() !== '' && typeof data?.text !== 'string';
}

/**
 * Sets a block's text, dropping any inline HTML.
 *
 * This is the one lossy operation in the editor and it is deliberate: the canvas
 * edits plain text, so once an author types into a formatted paragraph the bold and
 * the links cannot be reconstructed from what they typed. The block card warns
 * before the first keystroke rather than after (see BlockBody), so it is a choice
 * and not a surprise.
 */
export function setBlockText(data, text) {
  const next = { ...data, text };
  delete next.html;
  return next;
}
