/**
 * Dashboard tests.
 *
 * ---------------------------------------------------------------------------
 * WHY ONLY ResponsiveContainer IS MOCKED
 * ---------------------------------------------------------------------------
 * Recharts sizes itself by measuring its parent, and jsdom reports every element
 * as 0×0, so a real `<ResponsiveContainer>` renders an empty chart and every
 * assertion below would pass against nothing.
 *
 * The two ways out are stubbing `getBoundingClientRect` globally or mocking the
 * container. The global stub is rejected here: it changes the measured size of
 * *every* element in the tree, which quietly alters unrelated layout maths and
 * makes a failure hard to attribute. Mocking only `ResponsiveContainer` — cloning
 * its single child with a fixed width and height — leaves the rest of Recharts as
 * the real library, so these tests assert against genuinely rendered axes, ticks
 * and marks.
 *
 * Nothing here touches a network: `../../lib/api` is auto-mocked.
 */

import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

import DashboardPage from '../DashboardPage';
import { analyticsApi } from '../../lib/api';

jest.mock('../../lib/api');

/**
 * Rendering seven real Recharts charts into jsdom costs a few seconds per test,
 * which sits uncomfortably close to jest's 5s default once suites run in parallel.
 * Raised deliberately: the tests are slow, not hanging.
 */
jest.setTimeout(20000);

jest.mock('recharts', () => {
  const actual = jest.requireActual('recharts');
  const React = require('react');
  return {
    ...actual,
    ResponsiveContainer: ({ children }) =>
      React.cloneElement(children, { width: 640, height: 260 }),
  };
});

// ---------------------------------------------------------------------------
// Fixtures — the shape of GET /analytics/overview
// ---------------------------------------------------------------------------

const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];

const BASE_OVERVIEW = {
  totals: {
    total: 42,
    draft: 9,
    published: 28,
    scheduled: 3,
    archived: 2,
    // Deliberately below 10,000 so the compact formatter's output is a plain
    // grouped number and the assertion does not depend on the ICU version.
    total_views: 8450,
    avg_seo_score: 74.5,
    avg_aeo_score: 58.3,
    avg_geo_score: 41.7,
    avg_word_count: 1320,
    generation: { draft: 4, queued: 1, generating: 1, generated: 35, failed: 1 },
    in_flight: 2,
  },
  status_breakdown: [
    { status: 0, label: 'draft', count: 9 },
    { status: 1, label: 'published', count: 28 },
    { status: 2, label: 'scheduled', count: 3 },
    { status: 3, label: 'archived', count: 2 },
  ],
  published_over_time: MONTHS.map((month, index) => ({ month, count: index === 0 ? 0 : index })),
  // The first two months have no scored articles, which must render as gaps.
  word_count_trend: MONTHS.map((month, index) => ({
    month,
    avg_word_count: index < 2 ? null : 1100 + index * 40,
    articles: index < 2 ? 0 : index,
  })),
  seo_score_trend: MONTHS.map((month, index) => ({
    month,
    avg_seo_score: index < 2 ? null : 60 + index * 2,
  })),
  aeo_score_trend: MONTHS.map((month, index) => ({
    month,
    avg_aeo_score: index < 2 ? null : 45 + index * 3,
  })),
  geo_score_trend: MONTHS.map((month, index) => ({
    month,
    avg_geo_score: index < 2 ? null : 30 + index * 2,
  })),
  seo_score_distribution: [
    { label: '0–20', range: [0, 20], count: 0 },
    { label: '21–40', range: [21, 40], count: 2 },
    { label: '41–60', range: [41, 60], count: 6 },
    { label: '61–80', range: [61, 80], count: 14 },
    { label: '81–100', range: [81, 100], count: 11 },
  ],
  aeo_score_distribution: [
    { label: '0–20', range: [0, 20], count: 3 },
    { label: '21–40', range: [21, 40], count: 8 },
    { label: '41–60', range: [41, 60], count: 12 },
    { label: '61–80', range: [61, 80], count: 8 },
    { label: '81–100', range: [81, 100], count: 2 },
  ],
  geo_score_distribution: [
    { label: '0–20', range: [0, 20], count: 6 },
    { label: '21–40', range: [21, 40], count: 14 },
    { label: '41–60', range: [41, 60], count: 9 },
    { label: '61–80', range: [61, 80], count: 4 },
    { label: '81–100', range: [81, 100], count: 0 },
  ],
  top_keywords: [
    { keyword: 'mercury retrograde', count: 6, avg_seo_score: 78.2, total_views: 4300 },
    { keyword: 'shravan month rituals', count: 4, avg_seo_score: null, total_views: 900 },
  ],
  category_breakdown: [
    { category: 'Astrology', count: 20 },
    { category: 'Festivals', count: 12 },
    { category: 'Uncategorised', count: 10 },
  ],
  recent: [
    {
      id: 11,
      blog_title: 'Mercury retrograde survival guide',
      slug: 'mercury-retrograde-survival-guide',
      blog_status: 1,
      blog_status_label: 'published',
      generation_status: 'generated',
      seo_score: 82,
      aeo_score: 61,
      geo_score: 44,
      word_count: 1450,
      updated_at: '2026-07-20T10:00:00.000Z',
    },
  ],
  meta: { months: 7, serp_enabled: false, generated_at: '2026-07-27T00:00:00.000Z' },
};

const SERP_ROWS = [
  {
    blog_id: 11,
    blog_title: 'Mercury retrograde survival guide',
    keyword: 'mercury retrograde',
    position: 4,
    checked_at: '2026-07-20T09:00:00.000Z',
  },
  {
    blog_id: 12,
    blog_title: 'Shravan month rituals',
    keyword: 'shravan month rituals',
    position: 18,
    checked_at: '2026-07-21T09:00:00.000Z',
  },
];

function buildOverview(overrides = {}) {
  return {
    ...BASE_OVERVIEW,
    ...overrides,
    totals: { ...BASE_OVERVIEW.totals, ...(overrides.totals || {}) },
    meta: { ...BASE_OVERVIEW.meta, ...(overrides.meta || {}) },
  };
}

/**
 * Renders the page and waits for BOTH requests to settle.
 *
 * The overview and the in-flight poll resolve independently, so awaiting only the
 * first would let the second land after the test body — which React reports as a
 * state update outside act().
 */
async function renderDashboard(overrides) {
  analyticsApi.overview.mockResolvedValue(buildOverview(overrides));
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );
  await screen.findByText('Total blogs');
  await screen.findByText(/Nothing is generating right now|Running for/);
  return user;
}

/**
 * Runs an interaction and flushes everything it starts inside one act() scope.
 *
 * Nearly every control here triggers a refetch, so the promise chain settles
 * *after* the click's own act() scope has closed. Those late updates would
 * otherwise land outside act and React would report them - noise that says nothing
 * about the behaviour under test.
 */
async function interact(action) {
  await act(async () => {
    await action();
  });
}

/** The `<Card>` around one KPI tile, scoped to the metrics region. */
function kpiTile(label) {
  const metrics = screen.getByRole('region', { name: 'Key metrics' });
  const tile = within(metrics).getByText(label).closest('.rounded-xl');
  if (!tile) throw new Error(`No KPI tile found for "${label}"`);
  return tile;
}

const CHART_NAMES = [
  /blogs published over time/i,
  /status breakdown/i,
  /word count trend/i,
  /seo score trend/i,
  /aeo score trend/i,
  /geo score trend/i,
  /seo score distribution/i,
  /aeo score distribution/i,
  /geo score distribution/i,
  /top keywords/i,
  /content mix by category/i,
];

beforeEach(() => {
  jest.clearAllMocks();
  analyticsApi.inFlight.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// KPI tiles
// ---------------------------------------------------------------------------

describe('KPI tiles', () => {
  it('renders each headline metric from the payload', async () => {
    await renderDashboard();

    expect(within(kpiTile('Total blogs')).getByText('42')).toBeInTheDocument();
    expect(within(kpiTile('Published')).getByText('28')).toBeInTheDocument();
    expect(within(kpiTile('Avg SEO score')).getByText('74.5')).toBeInTheDocument();
    expect(within(kpiTile('Total views')).getByText('8,450')).toBeInTheDocument();
    expect(within(kpiTile('In-flight')).getByText('2')).toBeInTheDocument();
  });

  it('shows an em dash, not a zero, for an average with no data', async () => {
    await renderDashboard({ totals: { avg_seo_score: null } });

    const tile = kpiTile('Avg SEO score');
    expect(within(tile).getByText('—')).toBeInTheDocument();
    expect(within(tile).queryByText('0')).toBeNull();
  });

  it('requests the window chosen in the selector', async () => {
    const user = await renderDashboard();
    expect(analyticsApi.overview).toHaveBeenCalledWith({ months: 7 });

    await interact(() => user.selectOptions(screen.getByLabelText('Time window'), '12'));

    expect(analyticsApi.overview).toHaveBeenCalledWith({ months: 12 });
  });
});

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

describe('charts', () => {
  it('gives every chart an accessible name and a drawn plot', async () => {
    await renderDashboard();

    CHART_NAMES.forEach((name) => {
      const figure = screen.getByRole('figure', { name });
      // A rendered <svg> proves the chart got a usable size rather than
      // collapsing — the failure mode this whole file is built around.
      expect(figure.querySelector('svg')).not.toBeNull();
    });
  });

  it('renders the data it was given', async () => {
    await renderDashboard();

    // Axis ticks come from the payload, so their presence means the series bound.
    const published = screen.getByRole('figure', { name: /blogs published over time/i });
    expect(within(published).getByText('Jan 26')).toBeInTheDocument();
    expect(within(published).getByText('Jul 26')).toBeInTheDocument();

    const distribution = screen.getByRole('figure', { name: /seo score distribution/i });
    expect(within(distribution).getByText('81–100')).toBeInTheDocument();

    // Long keyword labels are truncated on the axis; the full text lives in the
    // table view and the tooltip.
    const keywords = screen.getByRole('figure', { name: /top keywords/i });
    expect(within(keywords).getByText('mercury retrogr…')).toBeInTheDocument();
  });

  it('describes a null month as a gap rather than a zero', async () => {
    await renderDashboard();

    const wordCount = screen.getByRole('figure', { name: /word count trend/i });
    expect(
      within(wordCount).getByText(/2 of 7 months have no data and are drawn as gaps, not as zero/i)
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The SERP chart is feature-flagged
// ---------------------------------------------------------------------------

describe('SERP ranking chart', () => {
  it('is absent when meta.serp_enabled is false', async () => {
    await renderDashboard({ meta: { serp_enabled: false } });

    expect(screen.queryByRole('figure', { name: /serp ranking/i })).toBeNull();
  });

  it('is present when meta.serp_enabled is true', async () => {
    await renderDashboard({ meta: { serp_enabled: true }, serp_rank: SERP_ROWS });

    const figure = screen.getByRole('figure', { name: /serp ranking/i });
    expect(figure.querySelector('svg')).not.toBeNull();
    // The axis has to declare its own inversion, or an inverted scale is a trap.
    expect(within(figure).getByText('Google position (1 = best)')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Table fallback
// ---------------------------------------------------------------------------

describe('table fallback', () => {
  it('swaps a chart for a real table with a caption and scoped headers', async () => {
    const user = await renderDashboard();

    const figure = screen.getByRole('figure', { name: /status breakdown/i });
    expect(within(figure).queryByRole('table')).toBeNull();

    await interact(() => user.click(within(figure).getByRole('button', { name: 'Show table' })));

    // The accessible name comes from the <caption>.
    const table = within(figure).getByRole('table', { name: /status breakdown — tabular view/i });
    expect(within(table).getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Articles' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Published' })).toBeInTheDocument();
    expect(within(table).getByText('28')).toBeInTheDocument();
    // The chart is gone, not merely hidden behind the table.
    expect(figure.querySelector('svg')).toBeNull();

    await interact(() => user.click(within(figure).getByRole('button', { name: 'Show chart' })));
    expect(within(figure).queryByRole('table')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// In-flight generations
// ---------------------------------------------------------------------------

describe('in-flight generations', () => {
  it('lists running generations and keeps polling', async () => {
    analyticsApi.inFlight.mockResolvedValue([
      {
        id: 31,
        blog_title: 'Guru Purnima explained',
        slug: 'guru-purnima',
        generation_status: 'generating',
        started_at: new Date().toISOString(),
      },
    ]);
    await renderDashboard();

    expect(screen.getByText('Guru Purnima explained')).toBeInTheDocument();
    expect(screen.getByText('Refreshing every 8 seconds.')).toBeInTheDocument();
  });

  it('stops polling and offers a manual refresh once nothing is in flight', async () => {
    await renderDashboard();

    expect(screen.getByText('Paused — nothing is currently generating.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Errors and responsiveness
// ---------------------------------------------------------------------------

describe('failure and small screens', () => {
  it('shows a retryable error banner when the overview request fails', async () => {
    analyticsApi.overview.mockRejectedValue({
      message: 'Cannot reach the server.',
      code: 'NETWORK_ERROR',
      status: null,
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Cannot reach the server.');

    analyticsApi.overview.mockResolvedValue(buildOverview());
    await interact(() => user.click(within(alert).getByRole('button', { name: 'Try again' })));

    expect(screen.getByText('Total blogs')).toBeInTheDocument();
    // The in-flight panel only mounts once the retry succeeds; the act() scope
    // above flushes its first poll too.
    expect(screen.getByText(/Nothing is generating right now/)).toBeInTheDocument();
  });

  it('renders at a 375px viewport', async () => {
    // jsdom has no layout engine, so this cannot measure overflow — the
    // no-horizontal-scroll guarantee comes from the Tailwind classes
    // (single-column grids, min-w-0 and per-container scroll). What it does prove
    // is that the mobile branch of every responsive component mounts and renders.
    window.innerWidth = 375;
    window.innerHeight = 812;
    window.dispatchEvent(new Event('resize'));

    await renderDashboard();

    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getAllByRole('figure')).toHaveLength(CHART_NAMES.length);
    expect(screen.getByText('Mercury retrograde survival guide')).toBeInTheDocument();
  });
});
