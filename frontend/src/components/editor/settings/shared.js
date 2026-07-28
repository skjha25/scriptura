// frontend/src/components/editor/settings/shared.js
/**
 * Pieces shared by more than one settings panel.
 *
 * Kept here rather than duplicated because "add/remove a row", "add/remove a column"
 * and "add/remove an item" are the same control with different nouns, and three
 * near-identical copies is how they drift apart.
 */

import clsx from 'clsx';

/**
 * A labelled pair of +/− buttons with the current count between them.
 *
 * The count is rendered as text, not inferred from the buttons, so a screen-reader
 * user knows the table has four rows without counting button presses. `min` disables
 * removal at the floor instead of hiding the button, so the control does not change
 * shape as you use it.
 */
export function CountControl({ label, count, unit, onAdd, onRemove, min = 1, disabled }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-ink-secondary">
        {label}
        <span className="ml-1.5 tabular text-ink-muted">
          {count} {count === 1 ? unit : `${unit}s`}
        </span>
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled || count <= min}
          aria-label={`Remove ${unit}`}
          className={clsx(
            'grid h-7 w-7 place-items-center rounded-md border border-hairline text-ink-muted',
            'transition-colors hover:bg-panel-raised hover:text-ink',
            'disabled:cursor-not-allowed disabled:opacity-40'
          )}
        >
          <span aria-hidden="true">−</span>
        </button>
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          aria-label={`Add ${unit}`}
          className={clsx(
            'grid h-7 w-7 place-items-center rounded-md border border-hairline text-ink-muted',
            'transition-colors hover:bg-panel-raised hover:text-ink',
            'disabled:cursor-not-allowed disabled:opacity-40'
          )}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
    </div>
  );
}

/** Explanatory note under a group of controls. */
export function SettingsNote({ children }) {
  return <p className="text-[11px] leading-relaxed text-ink-muted">{children}</p>;
}
