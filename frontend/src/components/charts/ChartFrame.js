/**
 * Accessible frame around one chart, plus its table fallback.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Four requirements land in the same place, so they are solved once here instead
 * of seven times across the chart components:
 *
 *   1. A chart is a `<figure>` with a real accessible name and a one-line text
 *      summary. An SVG full of `<path>` elements tells a screen-reader user
 *      nothing; the summary is what actually conveys the finding.
 *   2. Every chart needs a non-visual fallback. A picture is not data, so each
 *      figure can swap itself for a real `<table>` with a caption and scoped
 *      headers.
 *   3. Recharts needs a sized parent. The pixel height must live on a wrapper
 *      *outside* `<ResponsiveContainer>`, because the container measures its
 *      parent — put a percentage height on both and it resolves to zero.
 *   4. The `<figure>`/`<figcaption>` markup is fiddly enough that duplicating it
 *      would guarantee one chart eventually loses its label.
 */

import { useId, useState } from 'react';
import clsx from 'clsx';
import { ResponsiveContainer } from 'recharts';

import { Card } from '../ui/feedback';

/**
 * @typedef {object} TableColumn
 * @property {string} key Field on each row.
 * @property {string} label Column heading.
 * @property {'left'|'right'} [align]
 * @property {(value: any, row: object) => string} [format]
 */

/** Renders a null as an em dash — a blank cell reads as "zero" or "bug". */
function renderCell(column, row) {
  const value = row[column.key];
  if (column.format) return column.format(value, row);
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

/**
 * The chart's data as a real table.
 *
 * The caption is visually hidden because the figure's heading sits directly above
 * it and repeating the title on screen is noise — but a table still needs a
 * caption for anyone navigating by table, so it is present in the accessibility
 * tree rather than removed.
 */
function ChartDataTable({ caption, columns, rows }) {
  return (
    // Scrolls inside its own box. Without this a wide table at 375px would widen
    // the page instead.
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={clsx(
                  'border-b border-hairline pb-2 pr-3 font-semibold uppercase tracking-wide text-ink-muted',
                  column.align === 'right' && 'text-right'
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row[columns[0].key])} className="border-b border-hairline/60 last:border-0">
              {columns.map((column, columnIndex) =>
                columnIndex === 0 ? (
                  <th
                    key={column.key}
                    scope="row"
                    className="max-w-[12rem] truncate py-1.5 pr-3 font-medium text-ink-secondary"
                  >
                    {renderCell(column, row)}
                  </th>
                ) : (
                  <td
                    key={column.key}
                    className={clsx(
                      'py-1.5 pr-3 tabular text-ink',
                      column.align === 'right' && 'text-right'
                    )}
                  >
                    {renderCell(column, row)}
                  </td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * @param {object} props
 * @param {string} props.title Names the figure; becomes its accessible name.
 * @param {string} props.summary One line describing what the chart shows.
 * @param {number} [props.height] Plot height in pixels.
 * @param {TableColumn[]} props.columns Table-view columns; the first is the row header.
 * @param {object[]} props.rows Table-view rows, keyed by the first column's value.
 * @param {React.ReactNode} props.children A single Recharts chart element.
 */
export default function ChartFrame({
  title,
  summary,
  height = 240,
  columns,
  rows,
  children,
  className = '',
}) {
  const [showTable, setShowTable] = useState(false);
  const titleId = useId();
  const summaryId = useId();

  return (
    <Card
      as="figure"
      aria-labelledby={titleId}
      aria-describedby={summaryId}
      className={clsx('flex flex-col p-5', className)}
    >
      <figcaption className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={titleId} className="text-sm font-semibold text-ink">
            {title}
          </h3>
          <p id={summaryId} className="mt-1 text-xs leading-relaxed text-ink-muted">
            {summary}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowTable((current) => !current)}
          aria-pressed={showTable}
          className="shrink-0 rounded-md border border-hairline px-2 py-1 text-[11px] font-medium text-ink-secondary transition-colors hover:border-hairline-strong hover:text-ink"
        >
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      </figcaption>

      {showTable ? (
        <ChartDataTable caption={`${title} — tabular view`} columns={columns} rows={rows} />
      ) : (
        // Inline style: a computed pixel height, which no utility class can carry.
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
