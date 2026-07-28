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
 *
 * Sorted descending, which is what "top" means, so bar length and reading order
 * agree instead of fighting.
 *
 * ONE COLOUR, NOT ONE PER BAR: the category is already named on the axis, so
 * colouring each bar separately would encode the same fact twice and burn through
 * the validated palette for decoration. This is one series (rule 5 → no legend).
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

/** Row height that keeps a 12-row chart readable without becoming a scroll trap. */
const ROW_HEIGHT = 26;

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
      height={Math.max(160, data.length * ROW_HEIGHT + 32)}
    >
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 20, bottom: 4, left: 0 }}>
        <CartesianGrid {...GRID_PROPS} horizontal={false} />
        <XAxis type="number" {...AXIS_PROPS} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey={labelKey}
          {...AXIS_PROPS}
          // Fixed width so the plot does not jump as labels change length, and
          // narrow enough that the bars still have room at 375px. The tooltip
          // carries the untruncated text.
          width={112}
          tickFormatter={(value) => truncateLabel(value, 16)}
        />
        <Tooltip cursor={BAR_CURSOR} content={<ChartTooltip valueFormatter={formatCount} />} />
        <Bar
          dataKey={valueKey}
          name={valueName}
          fill={DATA_INK}
          radius={[0, 3, 3, 0]}
          maxBarSize={18}
          {...NO_MARK_ANIMATION}
        />
      </BarChart>
    </ChartFrame>
  );
}
