/**
 * frontend/src/pages/ClusterPage.js
 *
 * Keyword cluster list — the strategic view of content planning.
 *
 * Each cluster shows: name, head keyword, status badge, keyword count, and a
 * progress bar indicating how many keywords have published blogs.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

import { clustersApi } from '../lib/api';
import { humanizeEnum } from '../lib/constants';
import Button from '../components/ui/Button';
import { Input, Select } from '../components/ui/form';
import {
  Badge,
  EmptyState,
  ErrorBanner,
  Skeleton,
} from '../components/ui/feedback';
import { PAGE_ENTER, STAGGER_CONTAINER, STAGGER_CHILD } from '../lib/motion';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'planning', label: 'Planning' },
  { value: 'active', label: 'Active' },
  { value: 'complete', label: 'Complete' },
  { value: 'paused', label: 'Paused' },
];

const STATUS_TONES = {
  planning: 'neutral',
  active: 'accent',
  complete: 'good',
  paused: 'warning',
};

export default function ClusterPage() {
  const [clusters, setClusters] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page, limit: 20 };
      if (status) params.status = status;
      if (search.trim()) params.q = search.trim();
      const result = await clustersApi.list(params);
      setClusters(result.data);
      setPagination(result.pagination);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [page, status, search]);

  useEffect(() => { load(); }, [load]);

  return (
    <motion.div {...PAGE_ENTER} className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink" style={{ letterSpacing: '-0.02em' }}>
            Keyword Clusters
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Group related keywords into clusters. Schedule, generate, and dominate search coverage.
          </p>
        </div>
        <Button as={Link} to="/keywords" variant="primary">
          Keyword Pool →
        </Button>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 rounded-xl border border-hairline bg-panel-sunken p-3">
        <div className="flex-1 min-w-[220px]">
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by cluster name…"
          />
        </div>
        <div className="w-full sm:w-52">
          <Select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            options={STATUS_OPTIONS}
          />
        </div>
      </div>

      {error ? <ErrorBanner error={error} onRetry={load} /> : null}

      {/* Cluster grid */}
      {loading && !clusters ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="rounded-2xl border border-hairline bg-panel p-6">
              <Skeleton rows={3} />
            </div>
          ))}
        </div>
      ) : clusters && clusters.length === 0 ? (
        <div className="rounded-xl border border-hairline bg-panel p-12">
          <EmptyState
            icon="◎"
            title="No clusters yet"
            message="Select a keyword from the pool and click 'Expand to Cluster' to begin."
            action={<Button as={Link} to="/keywords" variant="primary">Go to Keyword Pool</Button>}
          />
        </div>
      ) : clusters ? (
        <motion.div
          variants={STAGGER_CONTAINER}
          initial="initial"
          animate="animate"
          className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3"
        >
          {clusters.map((cluster) => {
            const total = cluster.keyword_count || 0;
            const published = cluster.published_count || 0;
            const progress = total > 0 ? Math.round((published / total) * 100) : 0;
            const isComplete = progress === 100;

            return (
              <motion.div key={cluster.id} variants={STAGGER_CHILD}>
                <Link
                  to={`/clusters/${cluster.id}`}
                  className="group relative block rounded-2xl border border-hairline bg-panel p-6 shadow-panel
                             transition-all duration-200 ease-out
                             hover:-translate-y-1 hover:border-hairline-strong hover:shadow-panel-raised
                             focus-visible:outline-none focus-visible:shadow-focus-ring
                             flex flex-col justify-between h-full outline-none"
                  style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
                >
                  <div>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <h3 className="text-base font-semibold text-ink group-hover:text-brand transition-colors leading-snug" style={{ letterSpacing: '-0.01em' }}>
                        {cluster.name}
                      </h3>
                      <Badge tone={STATUS_TONES[cluster.status] || 'neutral'} className="shrink-0">
                        {humanizeEnum(cluster.status)}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-2 mb-5 text-sm text-ink-muted">
                      <svg className="h-3.5 w-3.5 shrink-0 text-ink-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                      </svg>
                      <span className="truncate">
                        Head: <span className="text-ink-secondary">{cluster.head_keyword}</span>
                      </span>
                      {cluster.is_seasonal && (
                        <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-status-warning/30 bg-status-warning/10 px-2 py-0.5 text-[11px] text-status-warning">
                          Seasonal
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Progress */}
                  <div>
                    <div className="mb-1.5 flex items-end justify-between text-xs">
                      <span className="font-medium text-ink-muted">Coverage</span>
                      <span className={`tabular font-semibold ${isComplete ? 'text-status-good' : 'text-brand'}`}>
                        {progress}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-sunken border border-hairline">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ease-out ${
                          isComplete ? 'bg-status-good' : 'bg-brand'
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="mt-1.5 text-right text-[11px] tabular text-ink-faint">
                      {published} of {total} articles live
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </motion.div>
      ) : null}

      {/* Pagination */}
      {pagination && pagination.pages > 1 ? (
        <div className="flex items-center justify-center gap-3 pt-4">
          <Button
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ← Previous
          </Button>
          <span className="px-3 py-1 rounded-lg border border-hairline bg-panel text-sm text-ink-secondary">
            {page} / {pagination.pages}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= pagination.pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </Button>
        </div>
      ) : null}
    </motion.div>
  );
}
