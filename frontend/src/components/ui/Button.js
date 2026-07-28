/**
 * Button component — Clean, Modern, Elegant UI Button System.
 *
 * Renders a real `<button>` (or an `<a>` via `as`), so keyboard activation, form
 * submission and focus all work without reimplementation.
 */

import { forwardRef } from 'react';
import clsx from 'clsx';
import Spinner from './Spinner';

const VARIANTS = {
  /** Clean, sleek primary action button (Linear / Vercel style) */
  primary:
    'bg-[#4F8CFF] text-white hover:bg-[#3B82F6] active:bg-[#2563EB] ' +
    'border border-blue-400/30 shadow-sm hover:shadow ' +
    'active:scale-[0.98]',

  /** Clean dark secondary button */
  secondary:
    'bg-panel-raised text-ink border border-hairline hover:border-hairline-strong ' +
    'hover:bg-panel-raised/80 hover:text-white active:scale-[0.98]',

  /** Clean ghost button */
  ghost:
    'bg-transparent text-ink-secondary border border-transparent ' +
    'hover:bg-white/[0.06] hover:text-white active:scale-[0.98]',

  /** Clean crimson danger button */
  danger:
    'bg-status-critical/15 text-status-critical border border-status-critical/30 ' +
    'hover:bg-status-critical/25 active:scale-[0.98]',

  /** Clean emerald success button */
  success:
    'bg-status-good/15 text-status-good border border-status-good/30 ' +
    'hover:bg-status-good/25 active:scale-[0.98]',
};

const SIZES = {
  sm: 'text-xs px-3 py-1.5 gap-1.5 rounded-lg font-medium',
  md: 'text-sm px-4 py-2 gap-2 rounded-lg font-medium',
  lg: 'text-base px-5 py-2.5 gap-2.5 rounded-lg font-semibold',
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
        'inline-flex items-center justify-center font-medium transition-all duration-150 ease-out select-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        VARIANTS[variant] || VARIANTS.secondary,
        SIZES[size] || SIZES.md,
        isDisabled && 'cursor-not-allowed opacity-50 hover:shadow-none hover:bg-opacity-100 active:scale-100',
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
