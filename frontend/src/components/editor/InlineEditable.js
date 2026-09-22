// frontend/src/components/editor/InlineEditable.js
/**
 * The editor's inline text field.
 *
 * ---------------------------------------------------------------------------
 * WHY AN AUTO-GROWING TEXTAREA AND NOT contentEditable
 * ---------------------------------------------------------------------------
 * Both were on the table. The textarea wins for four concrete reasons:
 *
 * 1. NATIVE UNDO SURVIVES. The spec requires that Ctrl+Z inside a text field keeps
 *    doing text undo rather than block undo. A textarea's undo stack is the
 *    browser's and is reliable; contentEditable's is not, and is routinely broken
 *    outright by React re-rendering the node under it.
 *
 * 2. NO CARET RESTORATION. A controlled contentEditable has to diff and re-place the
 *    caret after every parent render. That is the single largest source of bugs in
 *    hand-rolled block editors, and none of it is needed for plain text.
 *
 * 3. IT IS A REAL FORM CONTROL. Correct `role="textbox"`, correct accessible name
 *    from `aria-label`, correct behaviour with IME composition, mobile autocorrect
 *    and dictation — all of which contentEditable re-implements badly.
 *
 * 4. WHAT WE STORE IS PLAIN TEXT. Blocks hold `data.text`; inline formatting lives
 *    in `data.html`, which the canvas does not edit (see `setBlockText`). Editing
 *    plain text with a rich-text surface would be a mismatch.
 *
 * THE COST, AND HOW IT IS PAID
 * A textarea cannot show bold or a link while you edit it. That is real, and it is
 * why the live preview exists and is on by default. Directness is preserved by
 * making the control invisible: no border or background until focus, type scale and
 * leading matched to what the preview renders, and the height driven from content so
 * there is never a scrollbar inside a box inside the page.
 */

import { forwardRef, useCallback, useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';

/**
 * Wraps the textarea's current selection in an inline tag, or — with nothing
 * selected — inserts the tag around a short placeholder and selects it, so
 * either way the author lands with something to type over.
 *
 * Splicing the raw string and restoring selection by offset is what a real
 * textarea's native selection API makes reliable here (see this file's own
 * header comment on why contentEditable was rejected) — a Range-based
 * insert into a contentEditable is exactly the caret-restoration problem
 * that reasoning warns about.
 *
 * @returns {{value: string, selectionStart: number, selectionEnd: number}}
 */
function wrapSelection(current, start, end, openTag, closeTag, placeholder) {
  const hasSelection = end > start;
  const inner = hasSelection ? current.slice(start, end) : placeholder;
  const before = current.slice(0, start);
  const after = current.slice(hasSelection ? end : start);
  const next = `${before}${openTag}${inner}${closeTag}${after}`;
  const innerStart = before.length + openTag.length;
  return { value: next, selectionStart: innerStart, selectionEnd: innerStart + inner.length };
}

/** Small formatting toolbar for a `richText` field — Bold, Italic, and Link. */
function FormattingToolbar({ targetRef, onApply, disabled }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  function wrapWith(openTag, closeTag, placeholder) {
    const node = targetRef.current;
    if (!node) return;
    const result = wrapSelection(node.value, node.selectionStart, node.selectionEnd, openTag, closeTag, placeholder);
    onApply(result);
  }

  function submitLink(event) {
    event.preventDefault();
    const href = linkUrl.trim();
    if (href === '') return;
    // `href` is attribute-escaped, not left to the caller — this is the one
    // place user-typed text becomes an HTML attribute value.
    wrapWith(`<a href="${href.replace(/"/g, '&quot;')}">`, '</a>', 'link text');
    setLinkUrl('');
    setLinkOpen(false);
  }

  return (
    <div className="mb-1 flex flex-wrap items-center gap-1">
      <button
        type="button"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()} // keep textarea focus/selection intact
        onClick={() => wrapWith('<strong>', '</strong>', 'bold text')}
        aria-label="Bold"
        title="Bold"
        className="rounded border border-hairline px-1.5 py-0.5 text-xs font-bold text-ink-secondary hover:border-hairline-strong hover:text-ink disabled:opacity-40"
      >
        B
      </button>
      <button
        type="button"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => wrapWith('<em>', '</em>', 'italic text')}
        aria-label="Italic"
        title="Italic"
        className="rounded border border-hairline px-1.5 py-0.5 text-xs italic text-ink-secondary hover:border-hairline-strong hover:text-ink disabled:opacity-40"
      >
        I
      </button>
      <button
        type="button"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setLinkOpen((open) => !open)}
        aria-label="Insert link"
        title="Insert link"
        aria-expanded={linkOpen}
        className="rounded border border-hairline px-1.5 py-0.5 text-xs text-ink-secondary underline hover:border-hairline-strong hover:text-ink disabled:opacity-40"
      >
        Link
      </button>
      {linkOpen ? (
        <form onSubmit={submitLink} className="flex items-center gap-1">
          <input
            type="text"
            autoFocus
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            placeholder="https://…"
            aria-label="Link URL"
            className="w-40 rounded border border-hairline bg-transparent px-1.5 py-0.5 text-xs text-ink placeholder:text-ink-faint focus:border-accent/60 focus:outline-none"
          />
          <button type="submit" className="rounded border border-accent/40 px-1.5 py-0.5 text-xs text-accent-bright hover:bg-accent/10">
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setLinkOpen(false);
              setLinkUrl('');
            }}
            className="rounded border border-hairline px-1.5 py-0.5 text-xs text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
        </form>
      ) : null}
    </div>
  );
}

/**
 * @param {object} props
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 * @param {string} props.ariaLabel Required — the control has no visible label.
 * @param {string} [props.placeholder]
 * @param {boolean} [props.singleLine] Blocks Enter, for fields the renderer emits on
 *   one line (a heading, a list item, a CTA label).
 * @param {() => void} [props.onEnter] Fired instead of a newline when `singleLine`.
 * @param {boolean} [props.readOnly]
 * @param {boolean} [props.richText] Shows a Bold/Italic/Link toolbar above the field
 *   that wraps the current selection in inline markup — see `wrapSelection`.
 */
const InlineEditable = forwardRef(function InlineEditable(
  {
    value,
    onChange,
    ariaLabel,
    placeholder = '',
    singleLine = false,
    onEnter,
    readOnly = false,
    richText = false,
    className = '',
    ...rest
  },
  forwardedRef
) {
  const innerRef = useRef(null);
  // A toolbar click changes `value` via the controlled-input round trip, so the
  // new selection can only be applied once the DOM textarea actually holds the
  // new value — this ref carries the request from the click handler to the
  // layout effect below that fires right after that re-render.
  const pendingSelectionRef = useRef(null);

  /**
   * Matches the control's height to its content.
   *
   * `height: auto` first so the element can shrink as well as grow — measuring
   * scrollHeight against an already-tall box only ever reports the tall value.
   */
  const resize = useCallback(() => {
    const node = innerRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, []);

  // Layout effect, not effect: growing after paint is a visible jump on load.
  useLayoutEffect(() => {
    resize();
    const pending = pendingSelectionRef.current;
    if (pending && innerRef.current) {
      innerRef.current.focus();
      innerRef.current.setSelectionRange(pending.selectionStart, pending.selectionEnd);
      pendingSelectionRef.current = null;
    }
  }, [resize, value]);

  function applyFormatting(result) {
    pendingSelectionRef.current = { selectionStart: result.selectionStart, selectionEnd: result.selectionEnd };
    onChange(result.value);
  }

  const setRefs = useCallback(
    (node) => {
      innerRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef]
  );

  function handleKeyDown(event) {
    if (!singleLine || event.key !== 'Enter') return;
    event.preventDefault();
    onEnter?.();
  }

  return (
    <div>
      {richText && !readOnly ? (
        <FormattingToolbar targetRef={innerRef} onApply={applyFormatting} disabled={readOnly} />
      ) : null}
      <textarea
        ref={setRefs}
        rows={1}
        value={value}
        readOnly={readOnly}
        aria-label={ariaLabel}
        placeholder={placeholder}
        spellCheck
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        className={clsx(
          'block w-full resize-none overflow-hidden bg-transparent',
          'rounded-md border border-transparent px-1.5 py-0.5',
          'text-ink placeholder:text-ink-faint',
          'hover:border-hairline focus:border-accent/60 focus:outline-none',
          readOnly && 'cursor-default text-ink-secondary hover:border-transparent',
          className
        )}
        {...rest}
      />
    </div>
  );
});

export default InlineEditable;
