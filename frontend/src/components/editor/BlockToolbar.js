// frontend/src/components/editor/BlockToolbar.js
/**
 * The header strip of a block card: drag handle, type label, per-block actions.
 *
 * ---------------------------------------------------------------------------
 * WHY A HANDLE AND NOT A DRAGGABLE CARD
 * ---------------------------------------------------------------------------
 * The card is full of text fields. If the whole card were the drag activator, a
 * pointer-down to place a caret would start a drag, and a text selection dragged
 * across two lines would move the block. A dedicated handle costs one small target
 * and removes that entire conflict class.
 *
 * The handle is a real `<button>`, so it is in the tab order and dnd-kit's
 * KeyboardSensor can activate it with Space. Its accessible name says what it moves
 * and how ("Reorder Heading block, position 2 of 10"), because "drag handle" alone
 * tells a screen-reader user nothing about what they are about to move.
 */

import clsx from 'clsx';

/** Shared chrome for the icon-only actions. */
const ACTION_CLASS =
  'grid h-7 w-7 place-items-center rounded-md border border-transparent text-ink-muted ' +
  'transition-colors hover:border-hairline hover:bg-panel-raised hover:text-ink ' +
  'disabled:cursor-not-allowed disabled:opacity-40';

export default function BlockToolbar({
  label,
  position,
  total,
  selected,
  readOnly,
  dragHandleProps,
  onOpenSettings,
  onDuplicate,
  onDelete,
}) {
  return (
    <div className="flex items-center gap-1.5 border-b border-hairline px-2 py-1.5">
      <button
        type="button"
        // dnd-kit's KeyboardSensor only activates when the keydown target *is* the
        // activator node, which is why the ref and the listeners must both land on
        // this button and not on a wrapper.
        ref={dragHandleProps.setActivatorNodeRef}
        aria-label={`Reorder ${label} block, position ${position} of ${total}`}
        disabled={readOnly}
        className={clsx(
          'grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-muted',
          'cursor-grab transition-colors hover:bg-panel-raised hover:text-ink',
          'disabled:cursor-not-allowed disabled:opacity-40'
        )}
        {...dragHandleProps.attributes}
        {...dragHandleProps.listeners}
      >
        <span aria-hidden="true" className="text-sm leading-none">
          ⠿
        </span>
      </button>

      <span className="min-w-0 flex-1 truncate text-[11px] uppercase tracking-wide text-ink-muted">
        {label}
        <span className="ml-1.5 normal-case tracking-normal text-ink-faint">
          {position}/{total}
        </span>
      </span>

      <button
        type="button"
        onClick={onOpenSettings}
        aria-expanded={selected}
        aria-label={`Settings for ${label} block`}
        className={clsx(ACTION_CLASS, selected && 'border-brand/40 bg-brand/15 text-brand-light')}
      >
        <span aria-hidden="true" className="text-xs">
          ⚙
        </span>
      </button>

      <button
        type="button"
        onClick={onDuplicate}
        disabled={readOnly}
        aria-label={`Duplicate ${label} block`}
        className={ACTION_CLASS}
      >
        <span aria-hidden="true" className="text-xs">
          ⧉
        </span>
      </button>

      <button
        type="button"
        onClick={onDelete}
        disabled={readOnly}
        aria-label={`Delete ${label} block`}
        className={clsx(ACTION_CLASS, 'hover:text-status-critical')}
      >
        <span aria-hidden="true" className="text-xs">
          🗑
        </span>
      </button>
    </div>
  );
}
