/**
 * Button.
 *
 * Renders a real `<button>` (or an `<a>` via `as`), so keyboard activation, form
 * submission and focus all work without reimplementation.
 *
 * `loading` disables the button and swaps in a spinner while keeping the label
 * mounted — replacing the label with "Loading…" collapses the button's width and
 * makes the whole row jump.
 */

import { forwardRef } from 'react';
import clsx from 'clsx';
import Spinner from './Spinner';

const VARIANTS = {
  /** The one primary action on a screen. Carries the brand gradient. */
  primary:
    'bg-glow-accent text-white shadow-glow-sm hover:shadow-glow hover:brightness-110 ' +
    'active:brightness-95 border border-transparent',
  /** Secondary actions: visible but recessive. */
  secondary:
    'bg-panel-raised text-ink border border-hairline hover:border-hairline-strong ' +
    'hover:bg-panel-raised/80',
  /** Tertiary/inline actions with no chrome until hovered. */
  ghost: 'bg-transparent text-ink-secondary border border-transparent hover:bg-panel-raised hover:text-ink',
  /** Destructive actions. Paired with a confirmation, never used alone. */
  danger:
    'bg-status-critical/15 text-status-critical border border-status-critical/40 ' +
    'hover:bg-status-critical/25',
  /** Positive confirmation, e.g. publish. */
  success:
    'bg-status-good/15 text-status-good border border-status-good/40 hover:bg-status-good/25',
};

const SIZES = {
  sm: 'text-xs px-3 py-1.5 gap-1.5 rounded-md',
  md: 'text-sm px-4 py-2.5 gap-2 rounded-lg',
  lg: 'text-base px-6 py-3 gap-2.5 rounded-lg',
};

const Button = forwardRef(function Button(
  {
    as: Component = 'button',
    variant = 'secondary',
    size = 'md',
    loading = false,
    disabled = false,
    icon = null,
    className = '',
    children,
    type,
    ...rest
  },
  ref
) {
  const isDisabled = disabled || loading;

  return (
    <Component
      ref={ref}
      // A <button> inside a <form> defaults to type="submit", which submits the
      // form on any stray click. Default to "button" and opt in explicitly.
      type={Component === 'button' ? type || 'button' : type}
      disabled={Component === 'button' ? isDisabled : undefined}
      // An <a> cannot be disabled; aria-disabled plus removing the href is the
      // accessible equivalent.
      aria-disabled={isDisabled || undefined}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex items-center justify-center font-medium transition-all duration-150',
        'focus-visible:outline-none',
        VARIANTS[variant] || VARIANTS.secondary,
        SIZES[size] || SIZES.md,
        isDisabled && 'cursor-not-allowed opacity-50 hover:shadow-none hover:brightness-100',
        className
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === 'lg' ? 18 : 14} /> : icon}
      {children}
    </Component>
  );
});

export default Button;
