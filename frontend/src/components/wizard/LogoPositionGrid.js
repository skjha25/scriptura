// frontend/src/components/wizard/LogoPositionGrid.js
/**
 * Logo placement as a 3×3 visual grid.
 *
 * The spec asks for a grid rather than a dropdown, and the reason is that "bottom
 * right" in a list is a phrase the author has to translate, whereas a cell in the
 * shape of the image is the thing itself. So the grid is drawn to the aspect ratio
 * the generated images use.
 *
 * It is built from real radio inputs inside a fieldset, not clickable divs. That
 * is what gives it, for free and correctly: focus, Space to select, arrow keys to
 * move between options, one tab stop for the whole group, and the announcement
 * "Bottom right, radio button, 4 of 5, selected". The four cells that are not
 * valid positions — the edge midpoints — are inert spacers with no control in
 * them, so keyboard users never land on a dead option.
 */

import clsx from 'clsx';

import { LOGO_POSITION_LABELS } from '../../lib/constants';

/**
 * Grid layout, row-major. `null` is a spacer.
 *
 * `center` is a legitimate LOGO_POSITIONS value, so it takes the middle cell;
 * `none` is not a place on the image and is handled by the overlay toggle instead
 * of being smuggled in here as a ninth cell.
 */
const CELLS = Object.freeze([
  'top_left', null, 'top_right',
  null, 'center', null,
  'bottom_left', null, 'bottom_right',
]);

export default function LogoPositionGrid({ value, onChange, disabled = false }) {
  return (
    <fieldset disabled={disabled} className={clsx(disabled && 'opacity-50')}>
      <legend className="mb-2 text-xs font-medium text-ink-secondary">Logo position</legend>
      <div
        // 16:9, the shape the image generator returns, so the choice looks like
        // the result. Fixed max width: a full-bleed grid at 1440px would imply the
        // cells are bigger targets than they are.
        className="grid aspect-video w-full max-w-xs grid-cols-3 grid-rows-3 gap-1 rounded-lg border border-hairline bg-panel-sunken p-1"
      >
        {CELLS.map((position, index) =>
          position === null ? (
            <span
              // Position is the identity: these are layout spacers, not data.
              // eslint-disable-next-line react/no-array-index-key
              key={`spacer-${index}`}
              aria-hidden="true"
              className="rounded border border-dashed border-hairline/50"
            />
          ) : (
            <label
              key={position}
              className={clsx(
                'relative grid place-items-center rounded border text-center transition-colors',
                disabled ? 'cursor-not-allowed' : 'cursor-pointer',
                value === position
                  ? 'border-accent/60 bg-glow-subtle'
                  : 'border-hairline bg-panel hover:border-hairline-strong'
              )}
            >
              <input
                type="radio"
                name="logo-position"
                value={position}
                checked={value === position}
                disabled={disabled}
                onChange={() => onChange(position)}
                // Visually hidden but focusable — the cell is the visual, the
                // input is the control.
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className={clsx(
                  'h-3 w-6 rounded-sm transition-colors',
                  value === position ? 'bg-glow-accent' : 'bg-ink-faint/30'
                )}
              />
              <span className="sr-only">{LOGO_POSITION_LABELS[position]}</span>
              {/* The focus ring has to live on a sibling: the input itself is
                  sr-only, so its own ring would be invisible. */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded peer-focus-visible:shadow-focus-ring"
              />
            </label>
          )
        )}
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        {value && value !== 'none'
          ? `Logo sits ${LOGO_POSITION_LABELS[value].toLowerCase()}.`
          : 'Pick a corner or the centre.'}
      </p>
    </fieldset>
  );
}
