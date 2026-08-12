// frontend/src/pages/BlogListPage.js
/**
 * Blog list.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FILTERS LIVE IN THE URL AND THE VIEW MODE DOES NOT
 * ---------------------------------------------------------------------------
 * Filters, sort and page are *about the data*, so they belong in the query string:
 * a filtered list is then something you can paste into Slack, bookmark, or reload
 * without losing your place. React state would make all three impossible, and
 * mirroring the URL into state is how a "clear filters" button ends up emptying the
 * query string while leaving the checkboxes ticked.
 *
 * Grid-versus-table is the opposite kind of setting: it is *about the reader*, not
 * the data. Putting it in the URL would mean sharing a link also imposes your
 * layout preference on the recipient, so it lives in localStorage instead.
 *
 * The one piece of local state that shadows the URL is the search box. Keystrokes
 * are held here and debounced before they reach the query string — otherwise
 * typing "mercury retrograde" would push eighteen history entries and fire
 * eighteen requests.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';

import { blogsApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { BLOG_STATUS_LABELS, GENERATION_STATUS } from '../lib/constants';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';
import { Card, ErrorBanner, EmptyState, Skeleton } from '../components/ui/feedback';
import { formatCount } from '../components/charts/chartTheme';
import BlogFilters, { SORT_OPTIONS } from '../components/blogs/BlogFilters';
import BlogGrid from '../components/blogs/BlogGrid';
import BlogTable from '../components/blogs/BlogTable';
import BlogPagination from '../components/blogs/BlogPagination';
import AgentChatWidget from '../components/agents/AgentChatWidget';

const VIEW_STORAGE_KEY = 'scriptura.blogs.view';
const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;

const STATUS_LABEL_VALUES = Object.values(BLOG_STATUS_LABELS);
const GENERATION_VALUES = Object.values(GENERATION_STATUS);
const SORT_VALUES = SORT_OPTIONS.map((option) => option.value);

/**
 * Parses the query string into the filter object.
 *
 * Every value is validated against the enum it belongs to rather than trusted.
 * A hand-edited or stale link carrying `sort=blog_content` would otherwise reach
 * the API and come back 422 — a broken screen caused by a URL the user cannot see
 * anything wrong with. Unknown values fall back to the default instead.
 */
function readFilters(searchParams) {
  const sort = searchParams.get('sort');
  const generationStatus = searchParams.get('generation_status');
  const limit = Number(searchParams.get('limit'));

  return {
    q: searchParams.get('q') || '',
    status: (searchParams.get('status') || '')
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter((part) => STATUS_LABEL_VALUES.includes(part)),
    category: searchParams.get('category') || '',
    generationStatus: GENERATION_VALUES.includes(generationStatus) ? generationStatus : '',
    sort: SORT_VALUES.includes(sort) ? sort : 'created_at',
    order: searchParams.get('order') === 'ASC' ? 'ASC' : 'DESC',
    page: Math.max(1, Number(searchParams.get('page')) || 1),
    limit: [10, 20, 25, 50, 100].includes(limit) ? limit : PAGE_SIZE,
    includeDeleted: searchParams.get('include_deleted') === 'true',
  };
}

/**
 * The inverse. Defaults are omitted, so an unfiltered list has a clean `/blogs`
 * URL and a shared link contains only what the sender actually changed.
 */
function toSearchParams(filters) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.status.length > 0) params.set('status', filters.status.join(','));
  if (filters.category) params.set('category', filters.category);
  if (filters.generationStatus) params.set('generation_status', filters.generationStatus);
  if (filters.sort !== 'created_at') params.set('sort', filters.sort);
  if (filters.order !== 'DESC') params.set('order', filters.order);
  if (filters.page > 1) params.set('page', String(filters.page));
  if (filters.limit && filters.limit !== PAGE_SIZE) params.set('limit', String(filters.limit));
  if (filters.includeDeleted) params.set('include_deleted', 'true');
  return params;
}

/** Reads the stored view mode, tolerating storage being unavailable. */
function readStoredView() {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'table' ? 'table' : 'grid';
  } catch {
    // Safari private mode throws on access; the default view is fine.
    return 'grid';
  }
}

/**
 * Loading placeholder shaped like the view it replaces, so switching from skeleton
 * to content does not move anything.
 */
function ListSkeleton({ view }) {
  if (view === 'table') {
    return (
      <div className="space-y-3 rounded-xl border border-hairline bg-panel p-4">
        {Array.from({ length: 6 }).map((_, index) => (
          // eslint-disable-next-line react/no-array-index-key -- position is the identity
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        // eslint-disable-next-line react/no-array-index-key -- position is the identity
        <Card key={index} className="overflow-hidden">
          <Skeleton className="aspect-[16/9] w-full rounded-none" />
          <div className="space-y-3 p-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-1.5 w-full" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function BlogListPage() {
  const { isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);

  const [view, setView] = useState(readStoredView);
  const [searchInput, setSearchInput] = useState(() => searchParams.get('q') || '');
  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);

  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  /**
   * Category options.
   *
   * There is no `/categories` endpoint and `category` is an exact-match filter, so
   * a free-text box would mean guessing the exact string. Instead the categories
   * seen in every page loaded this session are accumulated and offered — which
   * grows as the user browses and, crucially, does not shrink when a filter
   * narrows the result set to a single category.
   */
  const [knownCategories, setKnownCategories] = useState([]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // Preference simply will not survive a reload.
    }
  }, [view]);

  /**
   * Debounced search → URL.
   *
   * Two guards, both load-bearing:
   *
   * 1. The debounce must have caught up with the box. `debouncedSearch` lags
   *    `searchInput` by design, so when something empties the box and the query
   *    string in the same tick — "clear filters" does exactly that — the stale
   *    debounced value would otherwise write the old term straight back and
   *    trigger a spurious refetch.
   * 2. It must actually differ from the URL, or this effect and the query string
   *    would keep writing to each other forever.
   */
  useEffect(() => {
    if (debouncedSearch !== searchInput) return;
    if (debouncedSearch === (searchParams.get('q') || '')) return;
    setSearchParams(
      (current) => {
        const next = { ...readFilters(current), q: debouncedSearch, page: 1 };
        return toSearchParams(next);
      },
      { replace: true }
    );
  }, [debouncedSearch, searchInput, searchParams, setSearchParams]);

  const query = useMemo(() => {
    const params = {
      page: filters.page,
      limit: filters.limit || PAGE_SIZE,
      sort: filters.sort,
      order: filters.order,
    };
    if (filters.q) params.q = filters.q;
    if (filters.status.length > 0) params.status = filters.status.join(',');
    if (filters.category) params.category = filters.category;
    if (filters.generationStatus) params.generation_status = filters.generationStatus;
    // The API ignores include_deleted for an editor, so sending it would be noise.
    if (filters.includeDeleted && isAdmin) params.include_deleted = true;
    return params;
  }, [filters, isAdmin]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await blogsApi.list(query);
      setResult(response);
      setKnownCategories((current) => {
        const merged = new Set(current);
        (response?.data || []).forEach((row) => {
          if (row.category) merged.add(row.category);
        });
        // Returning the same reference when nothing new appeared keeps this out of
        // the render loop.
        return merged.size === current.length ? current : [...merged].sort();
      });
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Applies a filter patch.
   *
   * `replace` rather than push: a filter tweak is a refinement of where you already
   * are, not a place you want to walk back through one checkbox at a time.
   * Any change resets to page 1 — page 4 of the previous result set is meaningless
   * against a new one, and usually lands the reader on an empty page.
   */
  const handleChange = useCallback(
    (patch) => {
      setSearchParams(
        (current) => {
          const next = { ...readFilters(current), ...patch };
          if (!('page' in patch)) next.page = 1;
          return toSearchParams(next);
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const handleClear = useCallback(() => {
    setSearchInput('');
    handleChange({ q: '', status: [], category: '', generationStatus: '' });
  }, [handleChange]);

  const runAction = useCallback(
    async (blog, action) => {
      setBusyId(blog.id);
      setActionError(null);
      try {
        await action(blog.id);
        // Reload rather than patch local state: publishing recomputes fields on the
        // server, and a soft delete may drop the row out of the current filter.
        await load();
      } catch (err) {
        setActionError(err);
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  const handlePublish = useCallback((blog) => runAction(blog, (id) => blogsApi.publish(id)), [runAction]);
  const handleDelete = useCallback((blog) => runAction(blog, (id) => blogsApi.remove(id)), [runAction]);
  const handleRestore = useCallback((blog) => runAction(blog, (id) => blogsApi.restore(id)), [runAction]);

  const blogs = result?.data || [];
  /** Only the narrowing filters count — `include_deleted` can only add rows. */
  const hasActiveFilters = Boolean(
    filters.q || filters.status.length > 0 || filters.category || filters.generationStatus
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-ink">All blogs</h1>
            <p className="mt-1 text-sm text-ink-muted">
              {result?.pagination
                ? `${formatCount(result.pagination.total)} matching ${
                    result.pagination.total === 1 ? 'article' : 'articles'
                  }`
                : 'Search, filter and publish the library.'}
            </p>
          </div>
          {/* A quiet spinner for a refetch that already has results on screen —
              swapping back to the skeleton would throw the reader's place away. */}
          {loading && result ? <Spinner className="text-accent" label="Updating list" /> : null}
        </div>
        <Button as={Link} to="/blogs/new" variant="primary">
          New article
        </Button>
      </header>

      <BlogFilters
        filters={filters}
        searchInput={searchInput}
        onSearchInput={setSearchInput}
        onChange={handleChange}
        onClear={handleClear}
        view={view}
        onViewChange={setView}
        categories={knownCategories}
        isAdmin={isAdmin}
        hasActiveFilters={hasActiveFilters}
      />

      {error ? <ErrorBanner error={error} onRetry={load} /> : null}
      {actionError ? (
        <ErrorBanner error={actionError} onDismiss={() => setActionError(null)} />
      ) : null}

      <section aria-label="Blog articles" aria-busy={loading || undefined} className="space-y-5">
        {loading && !result ? (
          <ListSkeleton view={view} />
        ) : blogs.length === 0 ? (
          <Card>
            {hasActiveFilters ? (
              // Two distinct facts, two distinct messages: an empty library needs a
              // "create one" nudge, whereas an over-filtered list needs a way out
              // of the filters. Showing the wrong one sends the reader nowhere.
              <EmptyState
                icon="✧"
                title="No articles match these filters"
                message="Nothing in the library matches the current search and filters. Widening them will bring results back."
                action={
                  // Worded differently from the toolbar's button on purpose: two
                  // controls with identical names on one screen is ambiguous both
                  // for a screen reader and for anyone describing the UI.
                  <Button variant="secondary" onClick={handleClear}>
                    Clear filters and show all
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon="✦"
                title="No articles yet"
                message="The library is empty. The wizard walks through topic, brand voice and generation in one pass."
                action={
                  <Button as={Link} to="/blogs/new" variant="primary">
                    Start an article
                  </Button>
                }
              />
            )}
          </Card>
        ) : (
          // `layout` so swapping between grid and table settles rather than snaps.
          <motion.div layout>
            {view === 'table' ? (
              <BlogTable
                blogs={blogs}
                filters={filters}
                busyId={busyId}
                isAdmin={isAdmin}
                onPublish={handlePublish}
                onDelete={handleDelete}
                onRestore={handleRestore}
              />
            ) : (
              <BlogGrid
                blogs={blogs}
                busyId={busyId}
                isAdmin={isAdmin}
                onPublish={handlePublish}
                onDelete={handleDelete}
                onRestore={handleRestore}
              />
            )}
          </motion.div>
        )}

        <BlogPagination
          pagination={result?.pagination}
          limit={filters.limit}
          onLimitChange={(limit) => handleChange({ limit, page: 1 })}
          busy={loading}
          onPageChange={(page) => handleChange({ page })}
        />
      </section>

      <AgentChatWidget agents={['blog_ops_agent']} defaultAgent="blog_ops_agent" />
    </div>
  );
}
