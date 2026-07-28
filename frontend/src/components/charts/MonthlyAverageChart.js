// frontend/src/components/charts/MonthlyAverageChart.js
/**
 * A monthly average as a line, with genuine gaps where the API returned null.
 *
 * ---------------------------------------------------------------------------
 * WHY ONE COMPONENT FOR TWO MEASURES
 * ---------------------------------------------------------------------------
 * `word_count_trend.avg_word_count` and `seo_score_trend.avg_seo_score` are the
 * same shape and the same reading task, so they share this component and render as
 * two sibling charts.
 *
 * They are deliberately NOT one dual-axis chart. Words-per-article sits in the
 * thousands and an SEO score is 0–100; a shared axis would flatten the score into
 * the baseline, and a second y-axis would invite the reader to compare two lines
 * whose crossing points mean nothing. Two charts, one scale each (rule 3).
 *
 * `connectNulls={false}` is the load-bearing prop. A month with no scored articles
 * has no average — it is missing data, not an average of zero — so the line must
 * break rather than dive to the floor and back (rule 9).
 */

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

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
  formatAverage,
} from './chartTheme';

/**
 * @param {object} props
 * @param {string} props.title
 * @param {string} props.seriesName Name shown in the tooltip.
 * @param {object[]} props.data Monthly rows.
 * @param {string} props.valueKey Field holding the average; may be null per row.
 * @param {string} props.unitLabel Used in the generated summary, e.g. 'words'.
 * @param {[number|string, number|string]} [props.domain] Recharts y-domain.
 * @param {number} [props.yAxisWidth]
 */
export default function MonthlyAverageChart({
  title,
  seriesName,
  data = [],
  valueKey,
  unitLabel,
  domain = ['auto', 'auto'],
  yAxisWidth = 44,
}) {
  const measured = data.filter((row) => row[valueKey] !== null && row[valueKey] !== undefined);
  const gaps = data.length - measured.length;

  const summary =
    measured.length === 0
      ? `No month in this window has a measurable average ${unitLabel}.`
      : `Average ${unitLabel} per article, by month.` +
        (gaps > 0
          ? ` ${gaps} of ${data.length} months have no data and are drawn as gaps, not as zero.`
          : '');

  const tableColumns = [
    { key: 'month', label: 'Month', format: (value) => formatMonthLong(value) },
    {
      key: valueKey,
      label: seriesName,
      align: 'right',
      // formatAverage preserves null, and the table renders that as an em dash.
      format: (value) => formatAverage(value) ?? '—',
    },
  ];

  return (
    <ChartFrame
      title={title}
      summary={summary}
      columns={tableColumns}
      rows={data}
      height={220}
    >
      <LineChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid {...GRID_PROPS} vertical={false} />
        <XAxis
          dataKey="month"
          {...AXIS_PROPS}
          tickFormatter={formatMonthShort}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis {...AXIS_PROPS} domain={domain} width={yAxisWidth} />
        <Tooltip
          cursor={CROSSHAIR}
          content={
            <ChartTooltip
              labelFormatter={formatMonthLong}
              valueFormatter={(value) => formatAverage(value) ?? '—'}
            />
          }
        />
        <Line
          type="monotone"
          dataKey={valueKey}
          name={seriesName}
          stroke={DATA_INK}
          strokeWidth={MARK_PROPS.strokeWidth}
          dot={{ ...MARK_PROPS.dot, fill: DATA_INK }}
          activeDot={MARK_PROPS.activeDot}
          connectNulls={false}
          {...NO_MARK_ANIMATION}
        />
      </LineChart>
    </ChartFrame>
  );
}
