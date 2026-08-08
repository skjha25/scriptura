/**
 * frontend/src/components/ui/Button.js
 *
 * Single button component. Every interactive state (hover, focus, active, disabled)
 * is explicit and mode-aware — not an opacity change.
 *
 * Renders a real `<button>` (or an `<a>` via `as`), so keyboard activation, form
 * submission and focus all work without reimplementation.
 */

import { forwardRef } from 'react';
import clsx from 'clsx';
import Spinner from './Spinner';

/**
 * Variant styles.
 *
 * Primary uses the `accent` token which is independently tuned per mode:
 *   Light: dark slate CTA (#0F172A) — high contrast on white
 *   Dark:  bright white CTA (#F0F2F5) — high contrast on dark surfaces
 * (Handled via `html.dark` in the CSS custom properties, not hardcoded.)
 *
 * bg-accent is defined via bg-[var] trick so we can use the Tailwind token directly.
 * For simplicity we use bg-ink/bg-void which are already mode-swapped tokens.
 */
const VARIANTS = {
  /**
   * Primary CTA — high-contrast filled button.
   * Uses ink/void pair: ink is near-black in light mode, near-white in dark mode.
   * This is the correct mode-aware CTA pattern for this design system.
   */
  primary:
    'bg-ink text-void font-medium ' +
    'hover:opacity-85 hover:-translate-y-px ' +
    'active:opacity-100 active:translate-y-0 active:scale-[0.98] ' +
    'shadow-sm',

  /**
   * Secondary — outlined, clearly secondary to primary.
   * Uses panel-raised background which adapts per mode.
   */
  secondary:
    'bg-panel-raised text-ink border border-hairline font-medium ' +
    'hover:border-hairline-strong hover:bg-panel-sunken ' +
    'active:scale-[0.98]',

  /**
   * Ghost — low-profile, for tertiary actions inside cards/tables.
   */
  ghost:
    'bg-transparent text-ink-secondary font-medium ' +
    'hover:text-ink hover:bg-panel-sunken ' +
    'active:scale-[0.98]',

  /**
   * Danger — destructive actions.
   */
  danger:
    'bg-status-critical/10 text-status-critical border border-status-critical/25 font-medium ' +
    'hover:bg-status-critical/20 hover:border-status-critical/40 ' +
    'active:scale-[0.98]',

  /**
   * Success — affirmative/completion actions.
   */
  success:
    'bg-status-good/10 text-status-good border border-status-good/25 font-medium ' +
    'hover:bg-status-good/20 hover:border-status-good/40 ' +
    'active:scale-[0.98]',
};

const SIZES = {
  sm: 'text-xs px-3 py-1.5 gap-1.5 rounded-lg',
  md: 'text-sm px-4 py-2 gap-2 rounded-lg',
  lg: 'text-[0.9375rem] px-5 py-2.5 gap-2.5 rounded-lg',
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
      type={Component === 'button' ? type || 'button' : type}
      disabled={Component === 'button' ? isDisabled : undefined}
      aria-disabled={isDisabled || undefined}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex items-center justify-center select-none',
        'transition-all duration-150 ease-out',
        VARIANTS[variant] || VARIANTS.secondary,
        SIZES[size] || SIZES.md,
        isDisabled && 'cursor-not-allowed opacity-40 pointer-events-none',
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
