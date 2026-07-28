/**
 * Indeterminate loading spinner.
 *
 * `role="status"` with a visually-hidden label so a screen reader announces the
 * wait; `aria-hidden` on the graphic itself so it is not read as an image.
 * The animation is CSS, so the global `prefers-reduced-motion` block in index.css
 * already neutralises it.
 */

import clsx from 'clsx';

function Spinner({ size = 16, className = '', label = 'Loading' }) {
  return (
    <span role="status" className={clsx('inline-flex items-center', className)}>
      <svg
        aria-hidden="true"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className="animate-spin-slow"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.22" strokeWidth="3" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export default Spinner;
