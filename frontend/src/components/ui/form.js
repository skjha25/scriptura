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

import { useId, forwardRef } from 'react';
import clsx from 'clsx';

/** Shared input chrome, so every control looks identical. */
const CONTROL_BASE =
  'w-full bg-panel-sunken text-ink placeholder:text-ink-faint border border-hairline rounded-lg ' +
  'px-3 py-2.5 text-sm transition-colors duration-150 ' +
  'hover:border-hairline-strong focus:border-accent focus:outline-none ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

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
 */
export function TagInput({ label, hint, value = [], onChange, placeholder, max = 30, id }) {
  const generatedId = useId();
  const inputId = id || generatedId;

  function addTag(raw) {
    const tag = String(raw).trim().replace(/,$/, '');
    if (tag === '' || value.length >= max) return;
    // Case-insensitive de-duplication, so "Shiva" and "shiva" do not both appear.
    if (value.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return;
    onChange?.([...value, tag]);
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addTag(event.target.value);
      event.target.value = '';
      return;
    }
    if (event.key === 'Backspace' && event.target.value === '' && value.length > 0) {
      onChange?.(value.slice(0, -1));
    }
  }

  return (
    <Field label={label} htmlFor={inputId} hint={hint || `Press Enter to add. Up to ${max}.`}>
      <div
        className={clsx(
          CONTROL_BASE,
          'flex min-h-[42px] flex-wrap items-center gap-1.5 py-1.5',
          'focus-within:border-accent'
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
          // Committing on blur too, so a typed-but-unsubmitted tag is not lost
          // when the user tabs away.
          onBlur={(event) => {
            addTag(event.target.value);
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
