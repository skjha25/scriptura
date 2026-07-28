/**
 * Blog list tests.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS MOCKED AND WHY
 * ---------------------------------------------------------------------------
 * `../../lib/api` is auto-mocked, so nothing here touches a server.
 *
 * `AuthContext` is mocked rather than wrapped in a real `<AuthProvider>`: the
 * provider bootstraps by calling `/meta` and `/auth/me` on mount, which against an
 * auto-mocked api module means calling `.then` on `undefined`. Mocking the hook
 * keeps the test about the list and lets `isAdmin` be flipped per case, which is
 * exactly what the restore-permission test needs.
 *
 * A `<LocationProbe>` is rendered alongside the page so the query string can be
 * asserted directly — the URL is the filter state here, so it is the thing under
 * test, not an implementation detail.
 */

import { render, screen, within, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

import BlogListPage from '../BlogListPage';
import { blogsApi } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

jest.mock('../../lib/api');
jest.mock('../../context/AuthContext', () => ({ useAuth: jest.fn() }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeBlog(overrides = {}) {
  return {
    id: 1,
    blog_title: 'Mercury retrograde survival guide',
    slug: 'mercury-retrograde-survival-guide',
    blog_status: 1,
    blog_status_label: 'published',
    generation_status: 'generated',
    seo_score: 82,
    word_count: 1450,
    total_views: 3200,
    publish_date: '2026-07-14',
    category: 'Astrology',
    article_type: 'how_to',
    blog_picture: 'blogs/July2026/mercury.png',
    blog_picture_url: '/uploads/blogs/July2026/mercury.png',
    deleted_at: null,
    created_at: '2026-07-01T08:00:00.000Z',
    updated_at: '2026-07-14T08:00:00.000Z',
    ...overrides,
  };
}

const SECOND_BLOG = makeBlog({
  id: 2,
  blog_title: 'Shravan month rituals',
  slug: 'shravan-month-rituals',
  blog_status: 0,
  blog_status_label: 'draft',
  generation_status: 'draft',
  seo_score: null,
  word_count: null,
  total_views: 0,
  publish_date: null,
  category: 'Festivals',
  blog_picture: null,
  blog_picture_url: null,
});

function listResponse(data, pagination = {}) {
  return {
    data,
    pagination: {
      page: 1,
      limit: 20,
      total: data.length,
      total_pages: 1,
      has_next: false,
      has_prev: false,
      ...pagination,
    },
  };
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-search">{location.search}</span>;
}

/** Longer than the page's 350ms search debounce. */
const PAST_DEBOUNCE_MS = 450;

async function renderList({ route = '/blogs' } = {}) {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route
          path="/blogs"
          element={
            <>
              <BlogListPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );

  // The search box debounces on a real timer, so its first (no-op) commit lands
  // ~350ms after mount. Flushing it inside act() here keeps that scheduled update
  // from surfacing mid-test as an "update was not wrapped in act" warning that has
  // nothing to do with whatever is being asserted.
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, PAST_DEBOUNCE_MS);
    });
  });

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

function locationSearch() {
  return screen.getByTestId('location-search').textContent;
}

beforeEach(() => {
  jest.clearAllMocks();
  // The view preference is persisted, so it has to be cleared or one test's
  // choice of "table" silently changes the next test's default view.
  localStorage.clear();
  useAuth.mockReturnValue({ isAdmin: false });
  blogsApi.list.mockResolvedValue(listResponse([makeBlog(), SECOND_BLOG]));
});

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

describe('rows', () => {
  it('renders a card per article with its badges and score', async () => {
    await renderList();

    expect(await screen.findByText('Mercury retrograde survival guide')).toBeInTheDocument();
    expect(screen.getByText('Shravan month rituals')).toBeInTheDocument();

    // Scoped to the results region: "Published" and "Draft" are also the names of
    // the status filter checkboxes, so an unscoped query is ambiguous.
    const results = within(screen.getByRole('region', { name: 'Blog articles' }));

    // Status and generation are labelled chips, never colour alone.
    expect(results.getByText('Published')).toBeInTheDocument();
    expect(results.getByText('Draft')).toBeInTheDocument();
    expect(results.getByText('Generated')).toBeInTheDocument();

    // A scored article gets a meter; an unscored one says so rather than showing 0.
    expect(results.getByRole('meter', { name: /SEO score 82 out of 100/i })).toBeInTheDocument();
    expect(results.getByText('Not scored')).toBeInTheDocument();

    expect(blogsApi.list).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      sort: 'created_at',
      order: 'DESC',
    });
  });

  it('publishes a row and reloads the list', async () => {
    blogsApi.publish.mockResolvedValue(makeBlog({ id: 2, blog_status: 1 }));
    const user = await renderList();
    await screen.findByText('Shravan month rituals');

    await interact(() =>
      user.click(screen.getByRole('button', { name: 'Publish Shravan month rituals' }))
    );

    expect(blogsApi.publish).toHaveBeenCalledWith(2);
    await waitFor(() => expect(blogsApi.list).toHaveBeenCalledTimes(2));
  });

  it('requires a second click to delete', async () => {
    blogsApi.remove.mockResolvedValue({ data: { id: 1 } });
    const user = await renderList();
    await screen.findByText('Mercury retrograde survival guide');

    await interact(() =>
      user.click(screen.getByRole('button', { name: 'Delete Mercury retrograde survival guide' }))
    );
    expect(blogsApi.remove).not.toHaveBeenCalled();

    await interact(() =>
      user.click(
        screen.getByRole('button', { name: 'Confirm deleting Mercury retrograde survival guide' })
      )
    );
    expect(blogsApi.remove).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// Filtering, searching, sorting, paging
// ---------------------------------------------------------------------------

describe('filters', () => {
  it('filters by status and records it in the URL', async () => {
    const user = await renderList();
    await screen.findByText('Mercury retrograde survival guide');

    await interact(() => user.click(screen.getByRole('checkbox', { name: 'Draft' })));

    expect(locationSearch()).toBe('?status=draft');
    expect(blogsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'draft' }));

    // A second status is added to the same comma-separated parameter.
    await interact(() => user.click(screen.getByRole('checkbox', { name: 'Scheduled' })));
    expect(locationSearch()).toBe('?status=draft%2Cscheduled');
    expect(blogsApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'draft,scheduled' })
    );
  });

  it('debounces the search box before it reaches the API', async () => {
    await renderList();
    await screen.findByText('Mercury retrograde survival guide');
    expect(blogsApi.list).toHaveBeenCalledTimes(1);

    // Timers are faked only from here, after the initial render has settled —
    // faking them earlier would stall the helper's own debounce flush.
    jest.useFakeTimers();
    try {
      // fireEvent rather than user-event: driving keystrokes through user-event
      // with jest's timers faked needs the two explicitly wired together, and this
      // test is about the debounce, not about keystroke fidelity.
      fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'shravan' } });
      // Still one call: the keystroke has not reached the URL, so nothing refetched.
      expect(blogsApi.list).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(PAST_DEBOUNCE_MS);
      });

      expect(blogsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'shravan' }));
      expect(blogsApi.list).toHaveBeenCalledTimes(2);
      expect(locationSearch()).toBe('?q=shravan');
    } finally {
      jest.useRealTimers();
    }
  });

  it('changes sort column and direction', async () => {
    const user = await renderList();
    await screen.findByText('Mercury retrograde survival guide');

    await interact(() => user.selectOptions(screen.getByLabelText('Sort by'), 'seo_score'));
    expect(blogsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'seo_score' }));

    await interact(() =>
      user.click(screen.getByRole('button', { name: /Reverse sort direction/i }))
    );
    expect(blogsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ order: 'ASC' }));
    expect(locationSearch()).toBe('?sort=seo_score&order=ASC');
  });

  it('paginates', async () => {
    blogsApi.list.mockResolvedValue(
      listResponse([makeBlog()], { page: 1, total: 45, total_pages: 3, has_next: true })
    );
    const user = await renderList();
    await screen.findByText('Mercury retrograde survival guide');
    expect(screen.getByText('Page 1 of 3 · 45 articles')).toBeInTheDocument();

    await interact(() => user.click(screen.getByRole('button', { name: 'Next' })));

    expect(blogsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(locationSearch()).toBe('?page=2');
  });

  it('restores every filter from the URL on load', async () => {
    await renderList({
      route: '/blogs?status=draft,scheduled&q=shravan&category=Festivals&generation_status=failed&sort=seo_score&order=ASC&page=2',
    });

    await waitFor(() =>
      expect(blogsApi.list).toHaveBeenCalledWith({
        page: 2,
        limit: 20,
        sort: 'seo_score',
        order: 'ASC',
        q: 'shravan',
        status: 'draft,scheduled',
        category: 'Festivals',
        generation_status: 'failed',
      })
    );

    expect(screen.getByRole('checkbox', { name: 'Draft' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Scheduled' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Published' })).not.toBeChecked();
    expect(screen.getByLabelText('Search')).toHaveValue('shravan');
    expect(screen.getByLabelText('Sort by')).toHaveValue('seo_score');
    expect(screen.getByLabelText('Generation state')).toHaveValue('failed');
  });

  it('falls back to defaults for a sort column the API would reject', async () => {
    // A stale or hand-edited link must not produce a 422 the user cannot diagnose.
    await renderList({ route: '/blogs?sort=blog_content&order=SIDEWAYS' });

    await waitFor(() =>
      expect(blogsApi.list).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'created_at', order: 'DESC' })
      )
    );
  });
});

// ---------------------------------------------------------------------------
// View toggle
// ---------------------------------------------------------------------------

describe('grid and table views', () => {
  it('swaps the grid for a real table and remembers the choice', async () => {
    const user = await renderList();
    await screen.findByText('Mercury retrograde survival guide');
    expect(screen.queryByRole('table')).toBeNull();

    await interact(() => user.click(screen.getByRole('button', { name: 'Table' })));

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Article' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'SEO score' })).toBeInTheDocument();
    expect(
      within(table).getByRole('rowheader', { name: /Mercury retrograde survival guide/ })
    ).toBeInTheDocument();
    expect(localStorage.getItem('scriptura.blogs.view')).toBe('table');
  });

  it('marks the sorted column with aria-sort in the table view', async () => {
    const user = await renderList({ route: '/blogs?sort=total_views&order=ASC' });
    await screen.findByText('Mercury retrograde survival guide');

    await interact(() => user.click(screen.getByRole('button', { name: 'Table' })));

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Views' })).toHaveAttribute(
      'aria-sort',
      'ascending'
    );
    expect(within(table).getByRole('columnheader', { name: 'Words' })).not.toHaveAttribute(
      'aria-sort'
    );
  });
});

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

describe('restore permission', () => {
  const deletedBlog = makeBlog({
    id: 7,
    blog_title: 'Abandoned eclipse draft',
    blog_status: 0,
    deleted_at: '2026-07-02T10:00:00.000Z',
  });

  it('hides the restore action and the deleted toggle from an editor', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    blogsApi.list.mockResolvedValue(listResponse([deletedBlog]));
    await renderList({ route: '/blogs?include_deleted=true' });

    await screen.findByText('Abandoned eclipse draft');
    expect(screen.queryByRole('button', { name: /Restore/i })).toBeNull();
    expect(screen.queryByLabelText('Include deleted')).toBeNull();
    // include_deleted is ignored for editors, so it is not even sent.
    expect(blogsApi.list).toHaveBeenCalledWith(
      expect.not.objectContaining({ include_deleted: true })
    );
  });

  it('offers restore to an admin', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    blogsApi.list.mockResolvedValue(listResponse([deletedBlog]));
    blogsApi.restore.mockResolvedValue(makeBlog({ id: 7, deleted_at: null }));
    const user = await renderList({ route: '/blogs?include_deleted=true' });

    await screen.findByText('Abandoned eclipse draft');
    expect(blogsApi.list).toHaveBeenCalledWith(
      expect.objectContaining({ include_deleted: true })
    );

    await interact(() =>
      user.click(screen.getByRole('button', { name: 'Restore Abandoned eclipse draft' }))
    );
    expect(blogsApi.restore).toHaveBeenCalledWith(7);
  });
});

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

describe('empty states', () => {
  it('invites the first article when the library is empty', async () => {
    blogsApi.list.mockResolvedValue(listResponse([], { total: 0 }));
    await renderList();

    expect(await screen.findByText('No articles yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start an article' })).toBeInTheDocument();
    expect(screen.queryByText('No articles match these filters')).toBeNull();
  });

  it('offers a way out of the filters when they exclude everything', async () => {
    blogsApi.list.mockResolvedValue(listResponse([], { total: 0 }));
    const user = await renderList({ route: '/blogs?q=nothing-matches-this&status=archived' });

    expect(await screen.findByText('No articles match these filters')).toBeInTheDocument();
    expect(screen.queryByText('No articles yet')).toBeNull();

    await interact(() =>
      user.click(screen.getByRole('button', { name: 'Clear filters and show all' }))
    );

    expect(locationSearch()).toBe('');
    expect(screen.getByLabelText('Search')).toHaveValue('');
  });
});

// ---------------------------------------------------------------------------
// Failure and responsiveness
// ---------------------------------------------------------------------------

describe('failure and small screens', () => {
  it('shows a retryable error banner when the list request fails', async () => {
    blogsApi.list.mockRejectedValueOnce({
      message: 'Cannot reach the server.',
      code: 'NETWORK_ERROR',
      status: null,
    });
    const user = await renderList();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Cannot reach the server.');

    await interact(() => user.click(within(alert).getByRole('button', { name: 'Try again' })));
    expect(screen.getByText('Mercury retrograde survival guide')).toBeInTheDocument();
  });

  it('renders at a 375px viewport', async () => {
    // jsdom has no layout engine, so overflow cannot be measured here. The
    // no-horizontal-scroll guarantee is structural: single-column grids below sm,
    // `min-w-0` on flex children, and the table's own `overflow-x-auto` wrapper.
    // What this proves is that the mobile branch mounts and stays interactive.
    window.innerWidth = 375;
    window.innerHeight = 812;
    window.dispatchEvent(new Event('resize'));

    const user = await renderList();
    await screen.findByText('Mercury retrograde survival guide');

    expect(screen.getByRole('heading', { level: 1, name: 'All blogs' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'View mode' })).toBeInTheDocument();

    await interact(() => user.click(screen.getByRole('button', { name: 'Table' })));
    const table = await screen.findByRole('table');
    // The scroll lives on the table's own wrapper, never on the page.
    expect(table.parentElement).toHaveClass('overflow-x-auto');
  });
});
