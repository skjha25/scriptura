// frontend/src/pages/DashboardPage.js
/**
 * Dashboard.
 *
 * ---------------------------------------------------------------------------
 * WHY ONE REQUEST
 * ---------------------------------------------------------------------------
 * `GET /analytics/overview` returns every aggregate this screen renders in a
 * single payload, and the whole page derives from that one object. Eight charts
 * fetching independently would mean eight full-table scans on the backend and,
 * worse, eight moments at which one panel could disagree with another — a KPI
 * tile saying 41 published while the chart beside it still showed 38. One request,
 * one consistent snapshot.
 *
 * The in-flight generations panel is the deliberate exception: it is *supposed* to
 * change under the reader, so it polls its own cheap endpoint rather than forcing
 * a re-aggregation of the whole dashboard every eight seconds.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

import { analyticsApi } from '../lib/api';

import Button from '../components/ui/Button';
import { Select } from '../components/ui/form';
import {
  Card,
  CardHeader,
  StatTile,
  StatusBadge,
  GenerationBadge,
  ErrorBanner,
  EmptyState,
  Skeleton,
} from '../components/ui/feedback';
import TriScoreBadge from '../components/shared/TriScoreBadge';

import PublishedOverTimeChart from '../components/charts/PublishedOverTimeChart';
import ScoreDistributionChart from '../components/charts/ScoreDistributionChart';
import MonthlyAverageChart from '../components/charts/MonthlyAverageChart';
import StatusDonutChart from '../components/charts/StatusDonutChart';
import RankedBarChart from '../components/charts/RankedBarChart';
import SerpRankChart from '../components/charts/SerpRankChart';
import { useInterval } from '../hooks/useDebouncedValue';
import { formatCount, formatCompact, formatAverage } from '../components/charts/chartTheme';
import { PAGE_ENTER, STAGGER_CONTAINER, STAGGER_CHILD } from '../lib/motion';

/**
 * Window options for the time-series charts.
 *
 * A `<Select>` rather than a number input on purpose: the API accepts 1–36 and
 * 422s outside it, and a free-text number field is an invitation to type 500 and
 * get a validation error for no reason. Every option here is inside the range by
 * construction.
 */
const MONTH_OPTIONS = [
  { value: '1', label: 'This month' },
  { value: '3', label: 'Last 3 months' },
  { value: '6', label: 'Last 6 months' },
  { value: '7', label: 'Last 7 months' },
  { value: '12', label: 'Last 12 months' },
  { value: '24', label: 'Last 24 months' },
  { value: '36', label: 'Last 36 months' },
];

/** Matches the backend's own default, so the first paint needs no explanation. */
const DEFAULT_MONTHS = '7';

/** Long enough not to hammer the API, short enough that progress feels live. */
const IN_FLIGHT_POLL_MS = 8000;

/** Keeps the ranked charts readable; the table view carries the full list. */
const MAX_RANKED_ROWS = 10;

const KEYWORD_COLUMNS = [
  { key: 'keyword', label: 'Keyword' },
  { key: 'count', label: 'Articles', align: 'right', format: (value) => formatCount(value) },
  {
    key: 'avg_seo_score',
    label: 'Avg SEO',
    align: 'right',
    format: (value) => formatAverage(value) ?? '—',
  },
  { key: 'total_views', label: 'Views', align: 'right', format: (value) => formatCount(value) },
];

const CATEGORY_COLUMNS = [
  { key: 'category', label: 'Category' },
  { key: 'count', label: 'Articles', align: 'right', format: (value) => formatCount(value) },
];


// ---------------------------------------------------------------------------
// In-flight generations
// ---------------------------------------------------------------------------

function formatElapsed(startedAt) {
  if (!startedAt) return '0s';
  const ms = Date.now() - new Date(startedAt).getTime();
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function InFlightPanel() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  const poll = useCallback(async () => {
    try {
      setItems(await analyticsApi.inFlight());
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    poll();
  }, [poll]);

  const shouldPoll = !error && (items === null || items.length > 0);
  useInterval(poll, shouldPoll ? IN_FLIGHT_POLL_MS : null);

  return (
    <Card as="section" aria-labelledby="in-flight-heading" className="flex flex-col">
      <CardHeader
        title={<span id="in-flight-heading">In-flight generations</span>}
        subtitle={
          shouldPoll ? 'Refreshing every 8 seconds.' : 'Paused — nothing is currently generating.'
        }
        action={
          shouldPoll ? null : (
            <Button size="sm" variant="ghost" onClick={poll}>
              Check again
            </Button>
          )
        }
      />

      <div className="px-5 pb-5 pt-4" aria-busy={items === null || undefined}>
        {error ? (
          <ErrorBanner error={error} onRetry={poll} />
        ) : items === null ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-1 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Nothing is generating right now. Runs started from the wizard appear here.
          </p>
        ) : (
          <ul className="space-y-4">
            {items.map((item) => (
              <li key={item.id}>
                <div className="flex items-start justify-between gap-3">
                  <Link
                    to={`/blogs/${item.id}/wizard`}
                    className="min-w-0 flex-1 truncate text-sm text-ink hover:text-brand-light"
                  >
                    {item.blog_title}
                  </Link>
                  <GenerationBadge status={item.generation_status} />
                </div>
                <p className="mt-1 text-[11px] text-ink-muted">
                  Running for {formatElapsed(item.started_at)}
                </p>
                <div
                  aria-hidden="true"
                  className="mt-2 h-1 overflow-hidden rounded-full bg-panel-sunken"
                >
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-brand" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}



// ---------------------------------------------------------------------------
// Recent activity
// ---------------------------------------------------------------------------

function RecentActivityPanel({ items = [] }) {
  return (
    <Card as="section" aria-labelledby="recent-heading" className="flex flex-col">
      <CardHeader
        title={<span id="recent-heading">Recent activity</span>}
        subtitle="The most recently created articles."
        action={
          <Button as={Link} to="/blogs" size="sm" variant="ghost">
            All blogs
          </Button>
        }
      />
      {items.length === 0 ? (
        <p className="px-5 pb-5 pt-4 text-sm text-ink-muted">Nothing has been created yet.</p>
      ) : (
        <ul className="divide-y divide-hairline px-5 pb-4 pt-1">
          {items.map((item) => (
            <li key={item.id} className="py-3">
              <Link
                to={`/blogs/${item.id}`}
                className="block truncate text-sm text-ink hover:text-brand-light"
              >
                {item.blog_title}
              </Link>
              <div className="mt-2.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={item.blog_status} />
                  <GenerationBadge status={item.generation_status} />
                  <span className="text-[11px] text-ink-muted">
                    {item.word_count ? `${formatCount(item.word_count)} words` : 'No content'}
                  </span>
                </div>
                <TriScoreBadge
                  seo={{ score: item.seo_score }}
                  aeo={{ score: item.aeo_score }}
                  geo={{ score: item.geo_score }}
                  variant="compact"
                  className="shrink-0"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

/**
 * Shaped like the real dashboard — five tiles then a two-column chart grid — so
 * nothing moves when the payload lands.
 */
function DashboardSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          // eslint-disable-next-line react/no-array-index-key -- position is the identity
          <Card key={index} className="p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-8 w-16" />
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          // eslint-disable-next-line react/no-array-index-key -- position is the identity
          <Card key={index} className="p-5">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="mt-2 h-3 w-56" />
            <Skeleton className="mt-5 h-[240px] w-full" />
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const [months, setMonths] = useState(DEFAULT_MONTHS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await analyticsApi.overview({ months: Number(months) }));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [months]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = data?.totals;
  const keywords = (data?.top_keywords || []).slice(0, MAX_RANKED_ROWS);
  const categories = (data?.category_breakdown || []).slice(0, MAX_RANKED_ROWS);

  return (
    <motion.div {...PAGE_ENTER} className="space-y-8">
      {/* The header stays mounted through loading and errors, so the window
          selector never disappears out from under the user. */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink" style={{ letterSpacing: '-0.02em' }}>Dashboard</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Publishing volume, content quality and what is generating right now.
          </p>
        </div>
        <Select
          label="Time window"
          value={months}
          onChange={(event) => setMonths(event.target.value)}
          options={MONTH_OPTIONS}
          containerClassName="w-full sm:w-48"
        />
      </header>

      {error ? <ErrorBanner error={error} onRetry={load} /> : null}

      {loading && !data ? <DashboardSkeleton /> : null}

      {data ? (
        <>
          {/* A labelled region rather than a bare div: the tiles are the headline
              summary of the page, and giving them a name lets a screen-reader user
              jump to them instead of walking five unrelated cards. */}
          <motion.section
            variants={STAGGER_CONTAINER}
            initial="initial"
            animate="animate"
            aria-label="Key metrics"
            className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4"
          >
            <motion.div variants={STAGGER_CHILD}><StatTile label="Total blogs" value={formatCount(totals.total)} /></motion.div>
            <motion.div variants={STAGGER_CHILD}><StatTile label="Published" value={formatCount(totals.published)} hint={`${formatCount(totals.draft)} still in draft`} /></motion.div>
            <motion.div variants={STAGGER_CHILD}><StatTile label="Avg SEO score" value={formatAverage(totals.avg_seo_score)} hint="Scored articles only" /></motion.div>
            <motion.div variants={STAGGER_CHILD}><StatTile label="Avg AEO score" value={formatAverage(totals.avg_aeo_score)} hint="Featured-snippet readiness" /></motion.div>
            <motion.div variants={STAGGER_CHILD}><StatTile label="Avg GEO score" value={formatAverage(totals.avg_geo_score)} hint="AI-citation readiness" /></motion.div>
            <motion.div variants={STAGGER_CHILD}><StatTile label="Total views" value={formatCompact(totals.total_views)} /></motion.div>
            <motion.div variants={STAGGER_CHILD}><StatTile label="In-flight" value={formatCount(totals.in_flight)} hint="Queued or generating" /></motion.div>
          </motion.section>

          <InFlightPanel />

          {totals.total === 0 ? (
            <Card>
              <EmptyState
                icon="✧"
                title="No articles yet"
                message="Once the first article is created its metrics appear here. There is nothing to chart from an empty table, so the panels stay hidden rather than showing eight empty axes."
                action={
                  <Button as={Link} to="/blogs/new" variant="primary">
                    Start an article
                  </Button>
                }
              />
            </Card>
          ) : (
            // `layout` so the grid reflows smoothly when the SERP panel appears or
            // the window length changes the chart heights.
            <motion.div
              layout
              className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2"
            >
              <PublishedOverTimeChart data={data.published_over_time} />
              <StatusDonutChart data={data.status_breakdown} />

              {/* Two charts, not one dual-axis chart — see MonthlyAverageChart. */}
              <MonthlyAverageChart
                title="Word count trend"
                seriesName="Avg words"
                data={data.word_count_trend}
                valueKey="avg_word_count"
                unitLabel="words"
                yAxisWidth={48}
              />
              <MonthlyAverageChart
                title="SEO score trend"
                seriesName="Avg SEO score"
                data={data.seo_score_trend}
                valueKey="avg_seo_score"
                unitLabel="SEO score"
                domain={[0, 100]}
                yAxisWidth={36}
              />
              <MonthlyAverageChart
                title="AEO score trend"
                seriesName="Avg AEO score"
                data={data.aeo_score_trend}
                valueKey="avg_aeo_score"
                unitLabel="AEO score"
                domain={[0, 100]}
                yAxisWidth={36}
              />
              <MonthlyAverageChart
                title="GEO score trend"
                seriesName="Avg GEO score"
                data={data.geo_score_trend}
                valueKey="avg_geo_score"
                unitLabel="GEO score"
                domain={[0, 100]}
                yAxisWidth={36}
              />

              <ScoreDistributionChart data={data.seo_score_distribution} scoreLabel="SEO" />
              <ScoreDistributionChart data={data.aeo_score_distribution} scoreLabel="AEO" />
              <ScoreDistributionChart data={data.geo_score_distribution} scoreLabel="GEO" />

              <RankedBarChart
                title="Top keywords"
                summary={`The ${keywords.length} most-targeted keywords, primary and secondary combined, counted across all articles.`}
                data={keywords}
                labelKey="keyword"
                valueKey="count"
                valueName="Articles"
                columns={KEYWORD_COLUMNS}
              />

              <RankedBarChart
                title="Content mix by category"
                summary={`How the library is distributed across ${categories.length} categories. Articles with no category are grouped as Uncategorised.`}
                data={categories}
                labelKey="category"
                valueKey="count"
                valueName="Articles"
                columns={CATEGORY_COLUMNS}
              />

              <RecentActivityPanel items={data.recent} />

              {/* Section 6 makes this chart conditional: `serp_rank` is absent
                  from the payload unless SerpAPI is configured, so the flag is
                  checked rather than the array's truthiness. */}
              {data.meta?.serp_enabled && data.serp_rank?.length > 0 ? (
                <SerpRankChart data={data.serp_rank} />
              ) : null}
            </motion.div>
          )}


        </>
      ) : null}
    </motion.div>
  );
}
