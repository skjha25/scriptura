// frontend/src/components/charts/RankedBarChart.js
/**
 * A ranked horizontal bar chart, shared by "top keywords" and "content mix".
 *
 * ---------------------------------------------------------------------------
 * WHY HORIZONTAL
 * ---------------------------------------------------------------------------
 * The labels are long free text — keyword phrases and category names. Under a
 * vertical axis they would have to be rotated, and rotated type is the single
 * fastest way to make a chart unreadable. Turning the chart on its side gives each
 * label a full horizontal line.
 */

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

import ChartFrame from './ChartFrame';
import ChartTooltip from './ChartTooltip';
import {
  AXIS_PROPS,
  GRID_PROPS,
  BAR_CURSOR,
  DATA_INK,
  NO_MARK_ANIMATION,
  truncateLabel,
  formatCount,
} from './chartTheme';

/** Row height that keeps a 12-row chart readable and uncrowded. */
const ROW_HEIGHT = 32;

/**
 * @param {object} props
 * @param {string} props.title
 * @param {string} props.summary
 * @param {object[]} props.data Pre-sorted, pre-truncated rows.
 * @param {string} props.labelKey Category field.
 * @param {string} props.valueKey Measure field.
 * @param {string} props.valueName Series name, used in the tooltip.
 * @param {import('./ChartFrame').TableColumn[]} props.columns Table-view columns.
 */
export default function RankedBarChart({
  title,
  summary,
  data = [],
  labelKey,
  valueKey,
  valueName,
  columns,
}) {
  return (
    <ChartFrame
      title={title}
      summary={summary}
      columns={columns}
      rows={data}
      height={Math.max(180, data.length * ROW_HEIGHT + 36)}
    >
      <BarChart data={data} layout="vertical" margin={{ top: 6, right: 24, bottom: 6, left: 4 }}>
        <CartesianGrid {...GRID_PROPS} horizontal={false} />
        <XAxis type="number" {...AXIS_PROPS} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey={labelKey}
          {...AXIS_PROPS}
          width={135}
          tickFormatter={(value) => truncateLabel(value, 16)}
        />
        <Tooltip cursor={BAR_CURSOR} content={<ChartTooltip valueFormatter={formatCount} />} />
        <Bar
          dataKey={valueKey}
          name={valueName}
          fill={DATA_INK}
          radius={[0, 4, 4, 0]}
          maxBarSize={18}
          {...NO_MARK_ANIMATION}
        />
      </BarChart>
    </ChartFrame>
  );
}
