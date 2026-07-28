/**
 * Button component — Ultra-Luxury AI Generated UI Button System.
 *
 * Renders a real `<button>` (or an `<a>` via `as`), so keyboard activation, form
 * submission and focus all work without reimplementation.
 */

import { forwardRef } from 'react';
import clsx from 'clsx';
import Spinner from './Spinner';

const VARIANTS = {
  /** AI Gradient Primary Button with Specular Light Highlight & Aura Glow */
  primary:
    'relative overflow-hidden bg-gradient-to-r from-[#4F8CFF] via-[#7C3AED] to-[#EC4899] text-white ' +
    'border border-white/20 shadow-[0_0_20px_rgba(79,140,255,0.35)] ' +
    'hover:shadow-[0_0_30px_rgba(124,58,237,0.55)] hover:scale-[1.02] ' +
    'active:scale-[0.98] after:absolute after:inset-x-0 after:top-0 after:h-[1px] ' +
    'after:bg-gradient-to-r after:from-transparent after:via-white/50 after:to-transparent',

  /** Dark Glass Metallic Secondary Button */
  secondary:
    'relative overflow-hidden bg-panel-raised/90 text-ink backdrop-blur-md ' +
    'border border-white/10 hover:border-accent/40 hover:bg-panel-raised ' +
    'shadow-[0_4px_20px_rgba(0,0,0,0.5)] hover:shadow-[0_0_20px_rgba(79,140,255,0.2)] ' +
    'hover:scale-[1.01] active:scale-[0.98] hover:text-white',

  /** Ghost Minimal AI Glass Button */
  ghost:
    'bg-transparent text-ink-secondary border border-transparent ' +
    'hover:bg-white/[0.08] hover:border-white/10 hover:text-white ' +
    'hover:scale-[1.01] active:scale-[0.98]',

  /** Critical Crimson Glow Button */
  danger:
    'relative overflow-hidden bg-gradient-to-r from-red-600 to-rose-600 text-white ' +
    'border border-red-400/30 shadow-[0_0_20px_rgba(239,68,68,0.35)] ' +
    'hover:shadow-[0_0_30px_rgba(239,68,68,0.55)] hover:scale-[1.02] active:scale-[0.98]',

  /** Emerald Launch / Success Button */
  success:
    'relative overflow-hidden bg-gradient-to-r from-emerald-600 to-teal-500 text-white ' +
    'border border-emerald-400/30 shadow-[0_0_20px_rgba(16,185,129,0.35)] ' +
    'hover:shadow-[0_0_30px_rgba(16,185,129,0.55)] hover:scale-[1.02] active:scale-[0.98]',
};

const SIZES = {
  sm: 'text-xs px-3.5 py-1.5 gap-1.5 rounded-lg font-medium',
  md: 'text-sm px-4.5 py-2.5 gap-2 rounded-xl font-medium',
  lg: 'text-base px-6 py-3 gap-2.5 rounded-xl font-semibold',
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
        'inline-flex items-center justify-center font-medium transition-all duration-200 ease-out select-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        VARIANTS[variant] || VARIANTS.secondary,
        SIZES[size] || SIZES.md,
        isDisabled && 'cursor-not-allowed opacity-50 hover:shadow-none hover:scale-100 active:scale-100',
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
