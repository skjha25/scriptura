// frontend/src/components/editor/AddBlockMenu.js
/**
 * Insert-a-block menu.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS POSITIONAL
 * ---------------------------------------------------------------------------
 * An "add block" button that only appends is a trap: the moment an author needs an
 * image between paragraphs three and four they have to add it at the end and drag it
 * up eight positions. So one of these sits in every gap between blocks, and each one
 * knows the index it inserts at. The gap trigger stays nearly invisible until hovered
 * or focused, otherwise eleven buttons would compete with the content for attention.
 *
 * The type list is driven from BLOCK_TYPE_META in the order of BLOCK_TYPES, so adding
 * a block type to the domain constants adds it here with no change to this file.
 *
 * Each option's accessible name is set explicitly ("Add Paragraph block") rather than
 * left to concatenate from the label and the hint — the hint reads as a description,
 * not as part of the name.
 */

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import clsx from 'clsx';

import { BLOCK_TYPES, BLOCK_TYPE_META } from '../../lib/constants';

/**
 * @param {object} props
 * @param {number} props.position Index the new block is inserted at.
 * @param {(type: string, position: number) => void} props.onInsert
 * @param {boolean} [props.disabled]
 * @param {'gap'|'primary'} [props.variant] `gap` is the recessive between-blocks
 *   trigger; `primary` is the always-visible one in the canvas header.
 * @param {string} [props.triggerLabel] Accessible name for the trigger.
 */
export default function AddBlockMenu({
  position,
  onInsert,
  disabled = false,
  variant = 'gap',
  triggerLabel,
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // Escape closes, and a click outside closes. Both are the expected affordances for
  // a popover, and neither is worth a library for one menu.
  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const label = triggerLabel || `Insert block at position ${position + 1}`;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-expanded={open}
        aria-label={label}
        className={clsx(
          'flex items-center justify-center gap-1.5 rounded-lg border text-xs transition-all',
          'disabled:cursor-not-allowed disabled:opacity-40',
          variant === 'primary'
            ? 'border-accent/40 bg-accent/15 px-3 py-2 text-accent-bright hover:bg-accent/25'
            : clsx(
                'w-full border-dashed border-transparent py-1 text-ink-faint',
                'hover:border-accent/40 hover:bg-accent/10 hover:text-accent-bright',
                'focus-visible:border-accent/40 focus-visible:text-accent-bright',
                open && 'border-accent/40 text-accent-bright'
              )
        )}
      >
        <span aria-hidden="true">+</span>
        {variant === 'primary' ? 'Add block' : null}
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14 }}
            className={clsx(
              'absolute z-20 mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-hairline',
              'bg-panel-raised p-2 shadow-panel',
              variant === 'primary' ? 'right-0' : 'left-0'
            )}
          >
            <p className="px-1 pb-1.5 text-[11px] uppercase tracking-wide text-ink-muted">
              Insert at position {position + 1}
            </p>
            <div className="grid grid-cols-2 gap-1">
              {BLOCK_TYPES.map((type) => {
                const meta = BLOCK_TYPE_META[type];
                return (
                  <button
                    key={type}
                    type="button"
                    aria-label={`Add ${meta.label} block`}
                    onClick={() => {
                      setOpen(false);
                      onInsert(type, position);
                    }}
                    className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/15"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-0.5 w-4 shrink-0 text-center text-accent"
                    >
                      {meta.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-ink">
                        {meta.label}
                      </span>
                      <span className="block truncate text-[11px] text-ink-muted">{meta.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
