// frontend/src/components/wizard/OutlineBuilder.js
/**
 * Manual outline builder: add, remove, reorder and indent sections.
 *
 * ---------------------------------------------------------------------------
 * WHY BUTTONS AND NOT DRAG-AND-DROP
 * ---------------------------------------------------------------------------
 * @dnd-kit is already a dependency and the editor uses it for blocks, but an
 * outline is a short list of one-line strings, and drag-and-drop for a short list
 * is the version that cannot be operated from a keyboard without a bespoke
 * announcer. Move-up / move-down / indent / outdent buttons are keyboard and
 * screen-reader operable by construction, and every button says which row it acts
 * on, so "Move up" is never ambiguous in a list of nine.
 *
 * Levels run 2–4, matching `blogs.outline`. Level 1 is absent on purpose: the H1
 * is the article title, and an outline that could add a second one would produce a
 * document with two top-level headings.
 */

import { useRef } from 'react';
import clsx from 'clsx';

import Button from '../ui/Button';
import { EmptyState } from '../ui/feedback';

export const MIN_OUTLINE_LEVEL = 2;
export const MAX_OUTLINE_LEVEL = 4;
/** Matches the 100-row ceiling on `blogs.outline`. */
const MAX_ROWS = 100;

export default function OutlineBuilder({ outline = [], onChange, disabled = false }) {
  /**
   * Focus follows a newly added row. Without it, adding three sections from the
   * keyboard means three trips back down the page to type in them.
   */
  const rowRefs = useRef([]);

  function update(next) {
    onChange(next);
  }

  function addRow() {
    if (outline.length >= MAX_ROWS) return;
    const previous = outline[outline.length - 1];
    // A new row inherits the previous row's level: consecutive sections are
    // usually siblings, and defaulting to H2 would fight the author on every add.
    update([...outline, { level: previous ? previous.level : MIN_OUTLINE_LEVEL, text: '' }]);
    const index = outline.length;
    // The row does not exist until React commits, so the focus call waits a tick.
    window.requestAnimationFrame(() => rowRefs.current[index]?.focus());
  }

  function setText(index, text) {
    update(outline.map((row, i) => (i === index ? { ...row, text } : row)));
  }

  function setLevel(index, delta) {
    update(
      outline.map((row, i) =>
        i === index
          ? {
              ...row,
              level: Math.min(MAX_OUTLINE_LEVEL, Math.max(MIN_OUTLINE_LEVEL, row.level + delta)),
            }
          : row
      )
    );
  }

  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= outline.length) return;
    const next = [...outline];
    [next[index], next[target]] = [next[target], next[index]];
    update(next);
    window.requestAnimationFrame(() => rowRefs.current[target]?.focus());
  }

  function remove(index) {
    update(outline.filter((_, i) => i !== index));
  }

  return (
    <div className="min-w-0">
      {outline.length === 0 ? (
        <EmptyState
          icon="☰"
          title="No outline yet"
          message="Generate one from the topic, or add sections by hand. Without an outline the generator decides the structure itself."
          className="rounded-lg border border-dashed border-hairline py-10"
        />
      ) : (
        <ol className="space-y-2">
          {outline.map((row, index) => (
            <li
              // Position is the identity here: rows have no id, and keying on the
              // text would remount the input on every keystroke and lose focus.
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              className="flex min-w-0 items-center gap-2"
              // Indent is a computed offset from the heading level, so it cannot
              // be a utility class.
              style={{ paddingLeft: `${(row.level - MIN_OUTLINE_LEVEL) * 1.25}rem` }}
            >
              <span
                aria-hidden="true"
                className="w-7 shrink-0 rounded border border-hairline bg-panel-sunken py-1 text-center text-[11px] font-medium text-ink-muted"
              >
                H{row.level}
              </span>
              <input
                ref={(element) => {
                  rowRefs.current[index] = element;
                }}
                type="text"
                value={row.text}
                disabled={disabled}
                onChange={(event) => setText(index, event.target.value)}
                aria-label={`Section ${index + 1} heading, level ${row.level}`}
                placeholder="Section heading"
                maxLength={255}
                className={clsx(
                  'min-w-0 flex-1 rounded-lg border border-hairline bg-panel-sunken px-3 py-1.5',
                  'text-sm text-ink placeholder:text-ink-faint transition-colors',
                  'hover:border-hairline-strong focus:border-brand focus:outline-none',
                  'disabled:opacity-50'
                )}
              />
              <span className="flex shrink-0 items-center gap-0.5">
                <OutlineAction
                  label={`Outdent section ${index + 1}`}
                  glyph="←"
                  onClick={() => setLevel(index, -1)}
                  disabled={disabled || row.level <= MIN_OUTLINE_LEVEL}
                />
                <OutlineAction
                  label={`Indent section ${index + 1}`}
                  glyph="→"
                  onClick={() => setLevel(index, 1)}
                  disabled={disabled || row.level >= MAX_OUTLINE_LEVEL}
                />
                <OutlineAction
                  label={`Move section ${index + 1} up`}
                  glyph="↑"
                  onClick={() => move(index, -1)}
                  disabled={disabled || index === 0}
                />
                <OutlineAction
                  label={`Move section ${index + 1} down`}
                  glyph="↓"
                  onClick={() => move(index, 1)}
                  disabled={disabled || index === outline.length - 1}
                />
                <OutlineAction
                  label={`Remove section ${index + 1}`}
                  glyph="×"
                  onClick={() => remove(index)}
                  disabled={disabled}
                />
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={addRow}
          disabled={disabled || outline.length >= MAX_ROWS}
        >
          Add section
        </Button>
        {outline.length > 0 ? (
          <p className="text-xs text-ink-muted">
            {outline.length} of {MAX_ROWS} sections
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Icon-only control. The glyph is decorative; the label is the real name. */
function OutlineAction({ label, glyph, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={clsx(
        'grid h-7 w-7 place-items-center rounded-md border border-transparent text-sm transition-colors',
        disabled
          ? 'cursor-not-allowed text-ink-faint/50'
          : 'text-ink-muted hover:border-hairline hover:bg-panel-raised hover:text-ink'
      )}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}
