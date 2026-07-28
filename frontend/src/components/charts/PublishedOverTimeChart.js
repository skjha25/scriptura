// frontend/src/components/charts/PublishedOverTimeChart.js
/**
 * Blogs published per month.
 *
 * WHY AN AREA CHART: the question is the shape of output over time, not the exact
 * count in any one month, and the backend gap-fills the series so every month in
 * the window is present. A faint fill under a 2px line reads as volume without
 * becoming a gradient light show.
 *
 * WHY ZERO IS PLOTTED HERE: a month with no posts is a real measurement — nothing
 * was published — so the line correctly touches the baseline. That is the opposite
 * of the average trends, where a missing month means "not measured" and must break
 * the line. The distinction is the whole of rule 9 and the two charts get it right
 * in opposite directions on purpose.
 *
 * One series, so no legend: the figure title names it.
 */

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

import ChartFrame from './ChartFrame';
import ChartTooltip from './ChartTooltip';
import {
  AXIS_PROPS,
  GRID_PROPS,
  MARK_PROPS,
  CROSSHAIR,
  CHART_MARGIN,
  DATA_INK,
  NO_MARK_ANIMATION,
  formatMonthShort,
  formatMonthLong,
  formatCount,
} from './chartTheme';

const TABLE_COLUMNS = [
  { key: 'month', label: 'Month', format: (value) => formatMonthLong(value) },
  { key: 'count', label: 'Published', align: 'right', format: (value) => formatCount(value) },
];

export default function PublishedOverTimeChart({ data = [] }) {
  const total = data.reduce((sum, row) => sum + (row.count || 0), 0);
  const summary =
    data.length === 0
      ? 'No months in the selected window.'
      : `Articles with a publish date in each of the last ${data.length} months. ` +
        `${formatCount(total)} published in total; months with none are shown as zero.`;

  return (
    <ChartFrame
      title="Blogs published over time"
      summary={summary}
      columns={TABLE_COLUMNS}
      rows={data}
      height={240}
    >
      <AreaChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid {...GRID_PROPS} vertical={false} />
        <XAxis
          dataKey="month"
          {...AXIS_PROPS}
          tickFormatter={formatMonthShort}
          // At 36 months the labels would collide; dropping the middle ones is
          // better than rotating them to 45 degrees.
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis {...AXIS_PROPS} allowDecimals={false} width={36} />
        <Tooltip
          cursor={CROSSHAIR}
          content={<ChartTooltip labelFormatter={formatMonthLong} valueFormatter={formatCount} />}
        />
        <Area
          type="monotone"
          dataKey="count"
          name="Published"
          stroke={DATA_INK}
          strokeWidth={MARK_PROPS.strokeWidth}
          fill={DATA_INK}
          // Faint enough to read as a ground tone rather than a second mark.
          fillOpacity={0.14}
          dot={{ ...MARK_PROPS.dot, fill: DATA_INK }}
          activeDot={MARK_PROPS.activeDot}
          {...NO_MARK_ANIMATION}
        />
      </AreaChart>
    </ChartFrame>
  );
}
