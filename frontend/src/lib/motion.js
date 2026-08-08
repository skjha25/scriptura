/**
 * frontend/src/lib/motion.js
 *
 * ONE motion system for the entire app.
 *
 * Import from here — never inline duration/easing values in a component.
 * Every page entrance, hover state, and stagger delay comes from this file.
 *
 * Timing philosophy:
 *   - Entrances feel snappy with expo-out: they accelerate fast then decelerate
 *     smoothly, reading as "instant but intentional."
 *   - Micro-interactions (hover, press) are faster and use a gentler curve so
 *     they feel reactive rather than theatrical.
 *   - Stagger offsets are short (40-60ms) — large stagger gaps make the page
 *     feel slow rather than elegant.
 */

/** The primary ease for all entrances and meaningful transitions. */
export const EASE_EXPO = [0.16, 1, 0.3, 1];

/** Faster ease for hover/active micro-interactions. */
export const EASE_OUT = [0.2, 0, 0, 1];

/** Page / section entrance — the default for any top-level motion.div */
export const PAGE_ENTER = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, ease: EASE_EXPO },
};

/** Lighter entrance for content already on screen (cards, panels) */
export const PANEL_ENTER = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, ease: EASE_EXPO },
};

/** Scale-in for menus, modals, popovers */
export const SCALE_ENTER = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  transition: { duration: 0.3, ease: EASE_EXPO },
};

/**
 * Staggered container — wrap a list/grid with this, give children
 * `variants={STAGGER_CHILD}` and the container handles the timing.
 */
export const STAGGER_CONTAINER = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.05,   // 50ms between children
      delayChildren: 0.05,     // slight pause before first child
    },
  },
};

/** Each child in a staggered container */
export const STAGGER_CHILD = {
  initial: { opacity: 0, y: 10 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: EASE_EXPO },
  },
};

/** Card row item entrance (horizontal, for list rows) */
export const LIST_CHILD = {
  initial: { opacity: 0, x: -8 },
  animate: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.3, ease: EASE_EXPO },
  },
  exit: {
    opacity: 0,
    x: 8,
    transition: { duration: 0.2, ease: EASE_OUT },
  },
};

/** Drawer / sidebar slide-in from left */
export const DRAWER_ENTER = {
  initial: { x: '-100%' },
  animate: { x: 0 },
  exit: { x: '-100%' },
  transition: { type: 'tween', duration: 0.25, ease: EASE_EXPO },
};

/** Overlay fade */
export const OVERLAY_ENTER = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2, ease: 'easeInOut' },
};
