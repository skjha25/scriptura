// frontend/src/components/charts/StatusDonutChart.js
/**
 * Publish-status mix as a donut.
 *
 * ---------------------------------------------------------------------------
 * WHY THE COLOURS ARE KEYED, NOT INDEXED
 * ---------------------------------------------------------------------------
 * This is the one chart on the dashboard where colour *is* the encoding, so it is
 * the one that has to be careful. The scale is built from the canonical status
 * codes in `BLOG_STATUS` — not from the order the API returned, and not from the
 * array after empty statuses are dropped. A status with zero articles therefore
 * cannot shift the hue of the ones beside it, and neither can a future filter
 * (rule 1: colour follows the entity, never its rank).
 *
 * `STATUS_COLORS` is deliberately untouched here. Publish status is not a health
 * signal, and spending the reserved good/warning/serious/critical hues on it would
 * leave nothing to say "this failed" with (rule 2).
 *
 * Four slices, so they are direct-labelled *and* legended: identity is never
 * carried by colour alone (rule 5).
 */

import { PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';

import { BLOG_STATUS_META } from '../../lib/constants';
import ChartFrame from './ChartFrame';
import ChartTooltip, { legendLabel, LEGEND_PROPS } from './ChartTooltip';
import {
  STATUS_KEYS,
  buildColorScale,
  LABEL_FILL,
  NO_MARK_ANIMATION,
  formatCount,
} from './chartTheme';

const colorForStatus = buildColorScale(STATUS_KEYS);

const TABLE_COLUMNS = [
  { key: 'label', label: 'Status' },
  { key: 'count', label: 'Articles', align: 'right', format: (value) => formatCount(value) },
  { key: 'share', label: 'Share', align: 'right' },
];

const RADIAN = Math.PI / 180;

/**
 * Direct slice label.
 *
 * Empty slices are skipped: a leader line pointing at a zero-width sector lands on
 * top of its neighbour's label and makes both unreadable.
 */
function renderSliceLabel({ cx, cy, midAngle, outerRadius, name, value }) {
  if (!value) return null;
  const radius = outerRadius + 14;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill={LABEL_FILL}
      fontSize={11}
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
    >
      {`${name} ${value}`}
    </text>
  );
}

export default function StatusDonutChart({ data = [] }) {
  // The API's `label` is the lowercase enum name; BLOG_STATUS_META carries the
  // display form, so the chart and the row badges read the same.
  const slices = data.map((row) => ({
    ...row,
    label: BLOG_STATUS_META[row.status]?.label || row.label,
  }));

  const total = slices.reduce((sum, row) => sum + (row.count || 0), 0);
  const rows = slices.map((row) => ({
    ...row,
    share: total > 0 ? `${Math.round((row.count / total) * 100)}%` : '—',
  }));

  const summary =
    total === 0
      ? 'No articles yet, so there is no status mix to show.'
      : `How all ${formatCount(total)} articles are split across the four publish states.`;

  return (
    <ChartFrame
      title="Status breakdown"
      summary={summary}
      columns={TABLE_COLUMNS}
      rows={rows}
      height={260}
    >
      <PieChart margin={{ top: 4, right: 60, bottom: 4, left: 60 }}>
        <Tooltip content={<ChartTooltip valueFormatter={formatCount} />} />
        <Legend {...LEGEND_PROPS} formatter={legendLabel} />
        <Pie
          data={slices}
          dataKey="count"
          nameKey="label"
          // A donut rather than a filled pie: the hole removes the centre, where a
          // pie's angles are hardest to judge anyway, and lightens the shape.
          innerRadius={48}
          outerRadius={70}
          // A hairline gap in the panel colour separates adjacent slices without
          // adding a stroke that would read as data.
          paddingAngle={1}
          stroke="none"
          {...NO_MARK_ANIMATION}
          label={renderSliceLabel}
          labelLine={false}
        >
          {slices.map((row) => (
            <Cell key={row.status} fill={colorForStatus(row.status)} />
          ))}
        </Pie>
      </PieChart>
    </ChartFrame>
  );
}
