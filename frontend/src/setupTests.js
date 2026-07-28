// frontend/src/setupTests.js
/**
 * Jest setup, loaded automatically by react-scripts before every test file.
 *
 * Without this, `@testing-library/jest-dom` has to be imported in each test file
 * individually — easy to forget, and the failure is confusing when you do:
 * `toBeVisible` / `toHaveValue` are simply not functions, which reads as a broken
 * matcher rather than a missing import.
 */

import '@testing-library/jest-dom';

/**
 * jsdom does not implement `matchMedia`, and Framer Motion's `MotionConfig
 * reducedMotion="user"` queries it on mount. Left undefined, any component tree
 * containing an animation throws during render.
 *
 * Reporting `matches: false` means tests run against the *animated* path, which is
 * the one users on default settings get — so tests exercise the same code path
 * production does rather than a quieter special case.
 */
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

/**
 * Recharts and dnd-kit both observe element size. jsdom ships neither observer, and
 * the resulting `ResizeObserver is not defined` points at node_modules rather than
 * at anything actionable.
 *
 * A no-op stub is right rather than a measuring polyfill: jsdom has no layout
 * engine, so every measurement would be 0 anyway. Layout is verified in a real
 * browser by e2e/tests/responsive.spec.js.
 */
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
}

if (typeof window !== 'undefined' && !window.IntersectionObserver) {
  window.IntersectionObserver = class IntersectionObserver {
    observe() {}

    unobserve() {}

    disconnect() {}

    takeRecords() {
      return [];
    }
  };
}

/**
 * `scrollIntoView` is called by the block editor when a newly inserted block should
 * come into view. jsdom does not implement it.
 */
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
