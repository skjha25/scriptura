/**
 * Form primitives.
 *
 * Every control here is a real form element wrapped for consistent styling and
 * accessibility. Three rules they all follow:
 *
 *   1. A label is always associated with its control by id — placeholder text is
 *      not a label, and disappears the moment the user types.
 *   2. An error is announced (`role="alert"`) and wired to the control via
 *      `aria-describedby` + `aria-invalid`, so it is not colour-only.
 *   3. Ids are generated with `useId` when not supplied, so a caller can drop a
 *      field in without inventing unique ids.
 */

import { useId, forwardRef, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

/** Shared input chrome, so every control looks identical. */
const CONTROL_BASE =
  'w-full bg-panel text-ink placeholder:text-ink-faint border border-hairline rounded-lg ' +
  'px-3 py-2.5 text-sm transition-colors duration-150 ' +
  'hover:border-hairline-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed shadow-sm';

const CONTROL_ERROR = 'border-status-critical/60 focus:border-status-critical';

/**
 * Label + control + hint/error wrapper.
 *
 * Renders the error in place of the hint rather than below it, so the field's
 * height does not change when validation fails and the form does not jump.
 */
export function Field({ label, htmlFor, hint, error, required, children, className = '' }) {
  return (
    <div className={clsx('space-y-1.5', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="block text-xs font-medium text-ink-secondary">
          {label}
          {required ? (
            <span className="ml-1 text-status-critical" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-status-critical">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef(function Input(
  { label, hint, error, required, id, className = '', containerClassName = '', ...rest },
  ref
) {
  const generatedId = useId();
  const inputId = id || generatedId;

  return (
    <Field
      label={label}
      htmlFor={inputId}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
        className={clsx(CONTROL_BASE, error && CONTROL_ERROR, className)}
        {...rest}
      />
    </Field>
  );
});

export const Textarea = forwardRef(function Textarea(
  { label, hint, error, required, id, rows = 5, className = '', containerClassName = '', ...rest },
  ref
) {
  const generatedId = useId();
  const inputId = id || generatedId;

  return (
    <Field
      label={label}
      htmlFor={inputId}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
        className={clsx(CONTROL_BASE, 'resize-y leading-6', error && CONTROL_ERROR, className)}
        {...rest}
      />
    </Field>
  );
});

/**
 * Native `<select>`.
 *
 * Deliberately not a custom dropdown: the native control gets mobile's wheel
 * picker, type-ahead, and full keyboard support for free, all of which a div-based
 * replacement has to rebuild badly.
 */
export const Select = forwardRef(function Select(
  {
    label,
    hint,
    error,
    required,
    id,
    options = [],
    placeholder,
    className = '',
    containerClassName = '',
    ...rest
  },
  ref
) {
  const generatedId = useId();
  const inputId = id || generatedId;

  return (
    <Field
      label={label}
      htmlFor={inputId}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      <div className="relative">
        <select
          ref={ref}
          id={inputId}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          className={clsx(
            CONTROL_BASE,
            // Room for the chevron, and the native arrow removed so ours is the
            // only one visible.
            'cursor-pointer appearance-none pr-9',
            error && CONTROL_ERROR,
            className
          )}
          {...rest}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => {
            const value = typeof option === 'string' ? option : option.value;
            const optionLabel = typeof option === 'string' ? option : option.label;
            return (
              <option key={value} value={value}>
                {optionLabel}
              </option>
            );
          })}
        </select>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted"
        >
          ▾
        </span>
      </div>
    </Field>
  );
});

/**
 * Searchable dropdown — a `Select` for a list long/grouped enough that typing
 * to filter beats scrolling. `options` take the same `{value, label}` shape
 * as `Select`, plus an optional `category` for a group heading.
 *
 * A real `<select>` was the first choice, same reasoning as `Select`'s own
 * comment — but a native select's browser-provided type-ahead only jumps to
 * the next option starting with the typed letter, not a real filter, which
 * stops helping the moment two options share a first letter. This is a
 * button + a floating panel rather than an `<input>` with a live dropdown,
 * so the field's own value is never ambiguous with in-progress search text.
 */
export function SearchableSelect({
  label,
  hint,
  error,
  required,
  id,
  options = [],
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  value,
  onChange,
  containerClassName = '',
}) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleOutsideClick(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  const selected = options.find((option) => option.value === value);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered =
    normalizedQuery === ''
      ? options
      : options.filter((option) => `${option.category || ''} ${option.label}`.toLowerCase().includes(normalizedQuery));

  // Groups filtered options under their category, preserving first-seen order —
  // matching how the field allowlist is already ordered (Blog, SEO, Images, Publishing).
  const groups = [];
  for (const option of filtered) {
    const category = option.category || '';
    let group = groups.find((g) => g.category === category);
    if (!group) {
      group = { category, items: [] };
      groups.push(group);
    }
    group.items.push(option);
  }

  function select(option) {
    onChange?.(option.value);
    setOpen(false);
    setQuery('');
  }

  return (
    <Field label={label} htmlFor={inputId} hint={hint} error={error} required={required} className={containerClassName}>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          id={inputId}
          onClick={() => setOpen((prev) => !prev)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={clsx(
            CONTROL_BASE,
            'flex cursor-pointer items-center justify-between gap-2 text-left',
            !selected && 'text-ink-faint',
            error && CONTROL_ERROR
          )}
        >
          <span className="truncate">
            {selected ? (selected.category ? `${selected.category} — ${selected.label}` : selected.label) : placeholder}
          </span>
          <span aria-hidden="true" className="shrink-0 text-ink-muted">▾</span>
        </button>

        {open ? (
          <div
            role="listbox"
            className="absolute z-20 mt-1 max-h-72 w-full overflow-hidden rounded-lg border border-hairline bg-panel shadow-lg"
          >
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setOpen(false);
                  setQuery('');
                }
              }}
              placeholder={searchPlaceholder}
              aria-label={`Search ${label || 'options'}`}
              className="w-full border-b border-hairline bg-transparent px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
            />
            <div className="max-h-60 overflow-y-auto py-1">
              {groups.length === 0 ? (
                <p className="px-3 py-2 text-xs text-ink-muted">No matching fields.</p>
              ) : (
                groups.map((group) => (
                  <div key={group.category || '_'}>
                    {group.category ? (
                      <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                        {group.category}
                      </p>
                    ) : null}
                    {group.items.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={option.value === value}
                        onClick={() => select(option)}
                        className={clsx(
                          'block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-panel-raised',
                          option.value === value ? 'bg-accent/10 text-accent-bright' : 'text-ink'
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}
      </div>
    </Field>
  );
}

/**
 * Switch-style toggle.
 *
 * Built on a real checkbox with the input visually hidden but still focusable, so
 * it is keyboard operable and announced correctly. `peer` classes drive the visual
 * state from the input's real checked/focus state rather than from React state,
 * which keeps the two from disagreeing.
 */
export function Toggle({ label, hint, checked, onChange, disabled, id, className = '' }) {
  const generatedId = useId();
  const inputId = id || generatedId;

  return (
    <label
      htmlFor={inputId}
      className={clsx(
        'flex cursor-pointer items-start gap-3 select-none',
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
    >
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          id={inputId}
          checked={Boolean(checked)}
          onChange={(event) => onChange?.(event.target.checked)}
          disabled={disabled}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={clsx(
            'block h-5 w-9 rounded-full border border-hairline bg-panel-sunken transition-colors',
            'peer-checked:border-accent/60 peer-checked:bg-accent/70',
            'peer-focus-visible:shadow-focus-ring'
          )}
        />
        <span
          aria-hidden="true"
          className={clsx(
            'pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-ink-secondary',
            'transition-transform duration-150 peer-checked:translate-x-4 peer-checked:bg-white'
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-ink">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-ink-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

/** Plain checkbox, for list-style multi-select (tags, link targets). */
export function Checkbox({ label, checked, onChange, disabled, id, className = '' }) {
  const generatedId = useId();
  const inputId = id || generatedId;

  return (
    <label
      htmlFor={inputId}
      className={clsx(
        'flex cursor-pointer items-center gap-2.5 text-sm text-ink',
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
    >
      <input
        type="checkbox"
        id={inputId}
        checked={Boolean(checked)}
        onChange={(event) => onChange?.(event.target.checked)}
        disabled={disabled}
        className="h-4 w-4 shrink-0 cursor-pointer rounded border-hairline bg-panel-sunken accent-accent"
      />
      <span>{label}</span>
    </label>
  );
}

/**
 * Free-text tag entry.
 *
 * Commits on Enter or comma and removes the last tag on Backspace when the input
 * is empty — the interaction people already expect from this control.
 *
 * Pasting (or typing, then hitting Enter over) a comma- or newline-separated
 * batch — "keyword one, keyword two, keyword three" pasted from notes — adds
 * every piece as its own tag in one go, rather than the whole string becoming
 * a single tag. Splitting one at a time by hand was the actual complaint this
 * was built for: a list of 10-15 keywords from notes needs one paste, not one
 * Enter per keyword.
 */
export function TagInput({ label, hint, value = [], onChange, placeholder, max = 30, id }) {
  const generatedId = useId();
  const inputId = id || generatedId;

  /**
   * Splits `raw` on commas and newlines, trims each piece, and adds every
   * non-empty one that is not already present (case-insensitive) — against
   * both the existing tags and earlier pieces in this same batch, so a pasted
   * "Shiva, shiva, Ganesha" adds two tags, not three. Silently stops at `max`
   * rather than throwing, matching the existing single-tag behavior.
   */
  function addTags(raw) {
    const pieces = String(raw)
      .split(/[,\n]/)
      .map((piece) => piece.trim())
      .filter(Boolean);
    if (pieces.length === 0) return;

    const next = [...value];
    for (const piece of pieces) {
      if (next.length >= max) break;
      if (next.some((existing) => existing.toLowerCase() === piece.toLowerCase())) continue;
      next.push(piece);
    }
    if (next.length !== value.length) onChange?.(next);
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addTags(event.target.value);
      event.target.value = '';
      return;
    }
    if (event.key === 'Backspace' && event.target.value === '' && value.length > 0) {
      onChange?.(value.slice(0, -1));
    }
  }

  /** A paste lands as one string with no per-character keydown, so comma-splitting has to happen here explicitly. */
  function handlePaste(event) {
    const pasted = event.clipboardData?.getData('text');
    if (!pasted || !/[,\n]/.test(pasted)) return; // a single pasted word behaves like normal typing
    event.preventDefault();
    addTags(`${event.target.value}${pasted}`);
    event.target.value = '';
  }

  return (
    <Field label={label} htmlFor={inputId} hint={hint || `Press Enter to add. Up to ${max}.`}>
      <div
        className={clsx(
          CONTROL_BASE,
          'flex min-h-[42px] flex-wrap items-center gap-1.5 py-1.5',
          'focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20'
        )}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent/15 px-2 py-0.5 text-xs text-accent-bright"
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange?.(value.filter((t) => t !== tag))}
              className="text-accent-bright/70 hover:text-white"
              aria-label={`Remove ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={inputId}
          type="text"
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          // Committing on blur too, so a typed-but-unsubmitted tag is not lost
          // when the user tabs away.
          onBlur={(event) => {
            addTags(event.target.value);
            event.target.value = '';
          }}
          placeholder={value.length === 0 ? placeholder : ''}
          disabled={value.length >= max}
          className="min-w-[8rem] flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
        />
      </div>
    </Field>
  );
}
