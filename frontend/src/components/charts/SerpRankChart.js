// frontend/src/components/charts/SerpRankChart.js
/**
 * Google position for the keywords that have had a rank check.
 *
 * Rendered only when `meta.serp_enabled` is true — `data.serp_rank` is absent
 * otherwise, and an empty panel for a switched-off integration is worse than no
 * panel. The condition lives in DashboardPage; this component assumes it has data.
 *
 * ---------------------------------------------------------------------------
 * WHY A DOT PLOT AND WHY THE AXIS IS INVERTED
 * ---------------------------------------------------------------------------
 * A rank is a position, not a magnitude. A bar's length would assert that position
 * 40 is "forty units of something" and that a longer bar is more — when in fact a
 * longer bar would mean a worse result. A dot has no length to misread: it simply
 * sits at a place on the scale.
 *
 * The position axis is REVERSED, so 1 lands at the right-hand end. Readers arrive
 * expecting "further along the axis is better"; left in its natural direction the
 * chart would put the best rankings hard against the left edge and read as exactly
 * the opposite of the truth. The axis is also titled with "1 = best", because an
 * inverted scale must say so rather than rely on the reader noticing.
 */

import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip } from 'recharts';

import ChartFrame from './ChartFrame';
import ChartTooltip from './ChartTooltip';
import {
  AXIS_PROPS,
  GRID_PROPS,
  CROSSHAIR,
  DATA_INK,
  LABEL_FILL,
  NO_MARK_ANIMATION,
  truncateLabel,
  formatCount,
} from './chartTheme';

/** Beyond this the category axis becomes an unreadable stack of labels. */
const MAX_ROWS = 12;
const ROW_HEIGHT = 26;

const TABLE_COLUMNS = [
  { key: 'axisLabel', label: 'Keyword' },
  { key: 'blog_title', label: 'Article' },
  { key: 'position', label: 'Position', align: 'right', format: (value) => formatCount(value) },
  {
    key: 'checked_at',
    label: 'Checked',
    align: 'right',
    format: (value) => (value ? new Date(value).toLocaleDateString('en-GB') : '—'),
  },
];

/**
 * A category axis silently merges rows that share a tick value, so two articles
 * ranking for the same keyword would land on top of each other and one would
 * vanish. Disambiguating only the duplicates keeps the common case clean.
 */
function withAxisLabels(rows) {
  const counts = rows.reduce((acc, row) => {
    acc.set(row.keyword, (acc.get(row.keyword) || 0) + 1);
    return acc;
  }, new Map());

  return rows.map((row) => ({
    ...row,
    axisLabel:
      counts.get(row.keyword) > 1 ? `${row.keyword} — ${row.blog_title}` : row.keyword,
  }));
}

export default function SerpRankChart({ data = [] }) {
  // The API sorts ascending by position, so slicing keeps the best results.
  const rows = withAxisLabels(data.slice(0, MAX_ROWS));
  const best = rows.length > 0 ? rows[0].position : null;

  const summary =
    rows.length === 0
      ? 'No keyword has had a rank check yet.'
      : `Current Google position per checked keyword, best first. Best is ${best}. ` +
        (data.length > MAX_ROWS
          ? `Showing the top ${MAX_ROWS} of ${data.length}; the table view has the rest.`
          : 'The axis runs right-to-left because a lower number is a better rank.');

  return (
    <ChartFrame
      title="SERP ranking"
      summary={summary}
      columns={TABLE_COLUMNS}
      // The table is the only place the full list is available, so it is not sliced.
      rows={withAxisLabels(data)}
      height={Math.max(160, rows.length * ROW_HEIGHT + 48)}
    >
      <ScatterChart margin={{ top: 4, right: 20, bottom: 20, left: 0 }}>
        <CartesianGrid {...GRID_PROPS} horizontal={false} />
        <XAxis
          type="number"
          dataKey="position"
          name="Position"
          {...AXIS_PROPS}
          allowDecimals={false}
          domain={[1, 'dataMax']}
          reversed
          label={{
            value: 'Google position (1 = best)',
            position: 'insideBottom',
            offset: -14,
            fill: LABEL_FILL,
            fontSize: 11,
          }}
        />
        <YAxis
          type="category"
          dataKey="axisLabel"
          name="Keyword"
          {...AXIS_PROPS}
          width={112}
          tickFormatter={(value) => truncateLabel(value, 16)}
        />
        {/* Pins every dot to one size. Without it Recharts would scale the symbol
            by an absent z value and the dots would differ for no reason. */}
        <ZAxis range={[72, 72]} />
        <Tooltip cursor={CROSSHAIR} content={<ChartTooltip />} />
        <Scatter data={rows} fill={DATA_INK} {...NO_MARK_ANIMATION} />
      </ScatterChart>
    </ChartFrame>
  );
}
