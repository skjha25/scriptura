// frontend/src/components/charts/ScoreDistributionChart.js
/**
 * SEO score distribution across the five buckets the API returns.
 *
 * WHY A HISTOGRAM, IN BUCKET ORDER: the x-axis is a continuous score band, so the
 * bars must stay in score order. Sorting a histogram by count — the reflex from
 * ranked bar charts — destroys the only thing it measures, which is shape.
 *
 * One series, so no legend. Each bar is labelled with its count directly, in an
 * ink token rather than the bar's own colour (rule 7), so the exact figure is
 * readable without a hover.
 */

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList } from 'recharts';

import ChartFrame from './ChartFrame';
import ChartTooltip from './ChartTooltip';
import {
  AXIS_PROPS,
  GRID_PROPS,
  BAR_CURSOR,
  CHART_MARGIN,
  DATA_INK,
  LABEL_FILL,
  NO_MARK_ANIMATION,
  formatCount,
} from './chartTheme';

const TABLE_COLUMNS = [
  { key: 'label', label: 'Score band' },
  { key: 'count', label: 'Articles', align: 'right', format: (value) => formatCount(value) },
];

export default function ScoreDistributionChart({ data = [] }) {
  const scored = data.reduce((sum, row) => sum + (row.count || 0), 0);
  const summary =
    scored === 0
      ? 'No articles have been scored yet, so every band is empty.'
      : `How ${formatCount(scored)} scored articles fall across the five SEO bands, lowest to ` +
        'highest. Unscored drafts are not counted.';

  return (
    <ChartFrame
      title="SEO score distribution"
      summary={summary}
      columns={TABLE_COLUMNS}
      rows={data}
      height={240}
    >
      <BarChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid {...GRID_PROPS} vertical={false} />
        <XAxis dataKey="label" {...AXIS_PROPS} />
        <YAxis {...AXIS_PROPS} allowDecimals={false} width={36} />
        <Tooltip
          cursor={BAR_CURSOR}
          content={
            <ChartTooltip
              labelFormatter={(label) => `Score ${label}`}
              valueFormatter={formatCount}
            />
          }
        />
        <Bar
          dataKey="count"
          name="Articles"
          fill={DATA_INK}
          radius={[3, 3, 0, 0]}
          maxBarSize={56}
          {...NO_MARK_ANIMATION}
        >
          <LabelList
            dataKey="count"
            position="top"
            fill={LABEL_FILL}
            fontSize={11}
            // A 0 above an empty bar is clutter, not information.
            formatter={(value) => (value > 0 ? value : '')}
          />
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}
