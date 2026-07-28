/**
 * Shared chart chrome, formatters and colour assignment.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * Recharts styles through per-element props and needs literal colour strings, so
 * it cannot read the Tailwind theme. Without one shared module each chart would
 * restate its own axis styling — and, the real hazard, pick its own colours.
 *
 * The palette in tailwind.config.js is only colourblind-safe *as a set applied in
 * a fixed order*. One ad-hoc pick anywhere silently voids the validation for the
 * whole dashboard, so every colour a chart uses comes from here.
 */

import { SERIES_COLORS, CHART_CHROME, BLOG_STATUS } from '../../lib/constants';

/**
 * The single-series data ink.
 *
 * Most of the dashboard's charts carry one measure, where colour encodes nothing
 * — the title and the axis already say what the marks are. Reaching for a
 * different hue per chart would imply a relationship between charts that does not
 * exist, so they share slot 1 and read as small multiples. Colour only becomes an
 * encoding in the status donut, which uses the ordered set below.
 */
export const DATA_INK = SERIES_COLORS[0];

/**
 * Residual colour for an "Other" bucket.
 *
 * Deliberately a neutral grey (`ink.faint`) rather than a ninth hue: there is no
 * validated ninth colour, and "Other" is a leftover rather than an entity, so it
 * should read as recessive next to the real categories.
 */
export const RESIDUAL_COLOR = '#5f5b7a';

/** How many entities can carry their own hue before the rest fold into "Other". */
export const SERIES_LIMIT = SERIES_COLORS.length;

/**
 * Publish statuses in their canonical order, taken from the enum rather than from
 * whatever order the API happened to return.
 *
 * This is what makes the donut's colours stable: a status with zero rows, or one
 * dropped by a filter, cannot shift the slot of any other status.
 */
export const STATUS_KEYS = Object.freeze(Object.values(BLOG_STATUS));

/**
 * Maps stable entity keys to series colours, assigned in fixed order.
 *
 * Callers pass the *canonical* key list, never a filtered or sorted one — the
 * whole point is that colour follows the entity and not its current rank.
 *
 * @param {Array<string|number>} keys Canonical, order-stable identity list.
 * @returns {(key: string|number) => string} Colour lookup, residual grey for anything unmapped.
 */
export function buildColorScale(keys) {
  const assigned = new Map();
  keys.forEach((key, index) => {
    if (index < SERIES_LIMIT) assigned.set(key, SERIES_COLORS[index]);
  });
  return function colorFor(key) {
    return assigned.get(key) ?? RESIDUAL_COLOR;
  };
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

/**
 * Axis styling. Recessive on purpose: the data marks should be the strongest ink
 * on the panel, not the frame drawn around them.
 */
export const AXIS_PROPS = Object.freeze({
  stroke: CHART_CHROME.axis,
  tick: { fill: CHART_CHROME.inkMuted, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: CHART_CHROME.axis },
});

/** Dashed rather than solid, so gridlines sit behind the marks instead of competing. */
export const GRID_PROPS = Object.freeze({
  stroke: CHART_CHROME.grid,
  strokeDasharray: '2 4',
});

/** Line and dot geometry: 2px strokes, 8px dots, no shadows. */
export const MARK_PROPS = Object.freeze({
  strokeWidth: 2,
  dot: { r: 4, strokeWidth: 0 },
  // The active dot is ringed in the panel colour so it reads as lifted without a
  // drop shadow on a data mark.
  activeDot: { r: 5, strokeWidth: 2, stroke: CHART_CHROME.surface },
});

/** Crosshair for line and area charts. */
export const CROSSHAIR = Object.freeze({
  stroke: CHART_CHROME.axis,
  strokeWidth: 1,
  strokeDasharray: '3 3',
});

/** Hover wash for bar charts, where a crosshair line would just add noise. */
export const BAR_CURSOR = Object.freeze({ fill: 'rgba(255,255,255,0.04)' });

/** Standard plot margins. Left is 0 because the y-axis carries its own width. */
export const CHART_MARGIN = Object.freeze({ top: 8, right: 12, bottom: 4, left: 0 });

/**
 * Spread onto every data-mark element.
 *
 * Recharts animates in JavaScript, so neither the `prefers-reduced-motion` block
 * in index.css nor `MotionConfig` in index.js reaches it — a reduced-motion user
 * would get the marks sweeping in regardless of having asked not to. Rather than
 * animate against a stated preference, the marks simply appear; the card they sit
 * in still animates in via Framer Motion, which does honour the setting.
 */
export const NO_MARK_ANIMATION = Object.freeze({ isAnimationActive: false });

/** Label colour for values drawn onto the plot — a text token, never the mark's hue. */
export const LABEL_FILL = CHART_CHROME.inkSecondary;

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

/**
 * '2026-07' → 'Jul 26'.
 *
 * Parsed and formatted in UTC. The backend builds these keys from UTC months, and
 * letting the browser's timezone reinterpret them would slide every label back a
 * month for anyone west of Greenwich.
 */
export function formatMonthShort(monthKey) {
  if (typeof monthKey !== 'string') return '';
  const date = new Date(`${monthKey}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return monthKey;
  return date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

/** '2026-07' → 'July 2026', for tooltips and the table view where space allows. */
export function formatMonthLong(monthKey) {
  if (typeof monthKey !== 'string') return '';
  const date = new Date(`${monthKey}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return monthKey;
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Thousands separators, or an em dash when there is nothing to show. */
export function formatCount(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('en-GB');
}

/** 12,400 → '12.4K'. For KPI tiles, where the exact figure is not the point. */
export function formatCompact(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  if (Math.abs(number) < 10000) return number.toLocaleString('en-GB');
  return new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(
    number
  );
}

/**
 * Rounds an average for display, preserving null.
 *
 * Null must survive: `StatTile` and the tooltip both render an em dash for it,
 * and collapsing it to 0 would claim a measurement that was never taken.
 */
export function formatAverage(value, fractionDigits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  return Number(Number(value).toFixed(fractionDigits)).toLocaleString('en-GB');
}

/** Shortens an axis label. The tooltip always carries the untruncated text. */
export function truncateLabel(text, max = 18) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
