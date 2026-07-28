/**
 * Recharts tooltip, restyled for the dark panel.
 *
 * WHY: Recharts' default tooltip is a white box with dark text. On the #141221
 * chart surface that is a torch in a dark room — it destroys the reader's dark
 * adaptation and is harder to read than no tooltip at all.
 *
 * It also matters for honesty. The default renders a missing value as `0`, which
 * would flatly contradict the gap the line deliberately draws for it. Here a null
 * reads as "No data".
 */

import { CHART_CHROME } from '../../lib/constants';

/**
 * @param {object} props Recharts injects `active`, `payload` and `label`.
 * @param {(label: any) => string} [props.labelFormatter] Formats the heading.
 * @param {(value: number, row: object) => string} [props.valueFormatter] Formats each value.
 * @param {string} [props.emptyText] Shown in place of a null value.
 */
export default function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
  emptyText = 'No data',
}) {
  if (!active || !payload || payload.length === 0) return null;

  const heading = labelFormatter ? labelFormatter(label) : label;

  return (
    <div className="pointer-events-none max-w-[16rem] rounded-lg border border-hairline-strong bg-panel-raised px-3 py-2 shadow-panel">
      {heading ? (
        <p className="mb-1 break-words text-xs font-medium text-ink">{heading}</p>
      ) : null}
      <ul className="space-y-0.5">
        {payload.map((entry) => {
          const missing = entry.value === null || entry.value === undefined;
          return (
            <li
              key={`${entry.dataKey ?? entry.name}`}
              className="flex items-center gap-2 whitespace-nowrap text-xs"
            >
              {/* The swatch carries the series identity so the value below can stay
                  in a text colour (rule 7). Inline style: the hue is computed. */}
              {entry.color ? (
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{ backgroundColor: entry.color }}
                />
              ) : null}
              <span className="text-ink-muted">{entry.name}</span>
              <span
                className={`ml-auto tabular font-semibold ${missing ? 'text-ink-faint' : 'text-ink'}`}
              >
                {missing
                  ? emptyText
                  : valueFormatter
                    ? valueFormatter(entry.value, entry.payload)
                    : entry.value}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Legend label renderer.
 *
 * Recharts colours legend text with the series colour, which breaks rule 7 —
 * coloured text on a dark panel is both low contrast and redundant, since the
 * swatch beside it already carries the identity. Passing this as the legend's
 * `formatter` puts the label back into an ink token.
 */
export function legendLabel(value) {
  return <span className="text-xs text-ink-secondary">{value}</span>;
}

/** Legend geometry shared by the charts that have one. */
export const LEGEND_PROPS = Object.freeze({
  iconType: 'square',
  iconSize: 9,
  wrapperStyle: { paddingTop: 8, fontSize: 11, color: CHART_CHROME.inkSecondary },
});
