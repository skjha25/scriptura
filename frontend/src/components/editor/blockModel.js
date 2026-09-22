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
 * Creates a block of `type`. When `data` is given (e.g. AI-proposed content
 * from AiEditBar/AgentChatWidget), it replaces the type's default shape
 * entirely rather than merging into it — the caller supplies a complete,
 * already-shaped object, so a partial merge would silently keep stale
 * defaults the caller never asked for. Omit `data` for the usual
 * sensible-empty-defaults behavior.
 * @param {string} type One of BLOCK_TYPES.
 * @param {object} [data]
 * @returns {{id: string, type: string, data: object}}
 */
export function createBlock(type, data) {
  const factory = DEFAULT_DATA[type];
  return { id: newBlockId(), type, data: data && typeof data === 'object' ? data : factory ? factory() : {} };
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
 * The editable projection of a block's text — what the canvas's textarea
 * actually shows and lets the author type into.
 *
 * A block generated by the model, or one the formatting toolbar has touched,
 * may carry `data.html` (inline `<strong>`, `<em>`, `<a href>`) instead of
 * `data.text`. Unlike the old plain-text-only projection, this returns the
 * markup as-is rather than stripping it — the toolbar (see InlineEditable's
 * `richText` mode) wraps a selection in real tags, and the author needs to
 * see and keep editing that markup, not have it silently discarded on the
 * next keystroke. The live preview alongside the canvas is what shows how it
 * actually renders, exactly as InlineEditable's own header comment already
 * relies on for the plain-text case.
 *
 * @param {object} data
 * @returns {string}
 */
export function editableValueOf(data) {
  if (typeof data?.html === 'string' && data.html !== '') return data.html;
  if (typeof data?.text === 'string') return data.text;
  return '';
}

/**
 * True when a string contains inline HTML markup, as opposed to plain prose
 * that merely contains a literal `<` or `>`. Used to decide, on every edit,
 * whether the new value belongs in `data.html` (rendered as markup) or
 * `data.text` (rendered as escaped text) — see `setBlockText`.
 */
function containsMarkup(value) {
  return /<[a-z][^>]*>/i.test(value);
}

/**
 * Sets a block's text from an edited value.
 *
 * Stores as `data.html` when the value contains markup (typed directly, or
 * — the common path — inserted by the formatting toolbar wrapping a
 * selection in `<strong>`/`<em>`/`<a>`) so the renderer applies it; otherwise
 * stores as plain `data.text`. This replaces the old always-plain-text
 * behavior: previously ANY edit to a formatted block silently dropped its
 * bold/italics/links, because the canvas only ever showed and saved stripped
 * text. Now formatting survives an edit exactly when the edited value still
 * contains it.
 */
export function setBlockText(data, text) {
  const next = { ...data };
  if (containsMarkup(text)) {
    next.html = text;
    delete next.text;
  } else {
    next.text = text;
    delete next.html;
  }
  return next;
}
