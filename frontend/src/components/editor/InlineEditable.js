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

import { forwardRef, useCallback, useLayoutEffect, useRef } from 'react';
import clsx from 'clsx';

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
    className = '',
    ...rest
  },
  forwardedRef
) {
  const innerRef = useRef(null);

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
  useLayoutEffect(resize, [resize, value]);

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
        'hover:border-hairline focus:border-brand/60 focus:outline-none',
        readOnly && 'cursor-default text-ink-secondary hover:border-transparent',
        className
      )}
      {...rest}
    />
  );
});

export default InlineEditable;
