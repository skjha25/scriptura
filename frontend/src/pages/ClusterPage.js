// frontend/src/pages/ClusterPage.js
/**
 * Keyword cluster list — the strategic view of content planning.
 *
 * Each cluster shows: name, head keyword, status badge, keyword count, and a
 * progress bar indicating how many keywords have published blogs. Links to the
 * detail page for expanding/scheduling individual keywords.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { clustersApi } from '../lib/api';
import { humanizeEnum } from '../lib/constants';
import Button from '../components/ui/Button';
import { Input, Select } from '../components/ui/form';
import AgentChatWidget from '../components/agents/AgentChatWidget';
import {
  Badge,
  EmptyState,
  ErrorBanner,
  Skeleton,
} from '../components/ui/feedback';

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
    <div className="space-y-8 animate-fade-in-up relative z-0">
      {/* Aurora Ambient Mesh Background */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-cosmic-wash opacity-40 blur-3xl mix-blend-screen" />

      <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between relative">
        <div className="space-y-2 relative">
          <div className="absolute -left-4 top-0 h-full w-1 rounded-r-md bg-glow-accent opacity-75" />
          <h1 className="text-4xl font-bold tracking-tight text-ink drop-shadow-md">
            Keyword Clusters
          </h1>
          <p className="max-w-2xl text-base text-ink-secondary">
            Group related keywords into dynamic clusters. Schedule, generate, and dominate search coverage with AI precision.
          </p>
        </div>
        <Button as={Link} to="/keywords" variant="primary" className="shadow-glow-sm hover:shadow-glow transition-shadow">
          <span className="flex items-center gap-2">
            Explore Keyword Pool 
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </span>
        </Button>
      </header>

      <div className="flex flex-wrap gap-4 rounded-xl border border-hairline bg-panel-sunken/40 p-4 shadow-panel backdrop-blur-md">
        <div className="flex-1 min-w-[240px]">
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by cluster name..."
            className="w-full bg-void/50 border-hairline focus:border-accent transition-colors"
          />
        </div>
        <div className="w-full sm:w-56">
          <Select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            options={STATUS_OPTIONS}
            className="w-full bg-void/50 border-hairline focus:border-accent transition-colors"
          />
        </div>
      </div>

      {error ? <ErrorBanner error={error} onRetry={load} /> : null}

      {loading && !clusters ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="rounded-2xl border border-hairline bg-panel-raised/50 p-6 shadow-panel backdrop-blur-sm">
              <Skeleton rows={3} />
            </div>
          ))}
        </div>
      ) : clusters && clusters.length === 0 ? (
        <div className="rounded-2xl border border-hairline bg-panel-raised/30 p-12 backdrop-blur-sm shadow-panel">
          <EmptyState
            icon={<span className="text-4xl text-accent drop-shadow-glow">◎</span>}
            title="No clusters constructed yet"
            message="Your strategic network begins here. Select a keyword from the pool and click 'Expand to Cluster' to initiate generation."
            action={<Button as={Link} to="/keywords" variant="primary">Access Keyword Pool</Button>}
          />
        </div>
      ) : clusters ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {clusters.map((cluster) => {
            const total = cluster.keyword_count || 0;
            const published = cluster.published_count || 0;
            const progress = total > 0 ? Math.round((published / total) * 100) : 0;
            const isComplete = progress === 100;

            return (
              <Link
                key={cluster.id}
                to={`/clusters/${cluster.id}`}
                className="group relative block outline-none"
              >
                {/* Glow effect on hover */}
                <div className="absolute -inset-0.5 rounded-2xl bg-glow-accent opacity-0 blur transition duration-500 group-hover:opacity-30 group-focus:opacity-40" />
                
                <div className="relative h-full rounded-2xl border border-hairline bg-panel-raised p-6 shadow-panel transition duration-300 group-hover:-translate-y-1 group-hover:bg-panel-raised/80 flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <h3 className="truncate text-lg font-semibold text-ink group-hover:text-accent-bright transition-colors">
                        {cluster.name}
                      </h3>
                      <Badge tone={STATUS_TONES[cluster.status] || 'neutral'} className="shrink-0 font-medium">
                        {humanizeEnum(cluster.status)}
                      </Badge>
                    </div>
                    
                    <div className="flex items-center gap-2 mb-6 text-sm text-ink-muted">
                      <svg className="h-4 w-4 text-accent/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                      </svg>
                      <span className="truncate">Head: <span className="text-ink-secondary">{cluster.head_keyword}</span></span>
                      {cluster.is_seasonal && (
                         <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-accent-violet/10 px-2 py-0.5 text-xs text-accent-violet border border-accent-violet/20">
                           <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                           </svg>
                           Seasonal
                         </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-auto">
                    <div className="mb-2 flex items-end justify-between text-xs">
                      <span className="font-medium text-ink-muted">Coverage</span>
                      <span className={`font-numeric font-bold ${isComplete ? 'text-status-good' : 'text-accent-bright drop-shadow-sm'}`}>
                        {progress}%
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-void border border-hairline-strong shadow-inner">
                      <div
                        className={`h-full rounded-full transition-all duration-1000 ease-out relative overflow-hidden ${
                          isComplete ? 'bg-status-good' : 'bg-glow-accent'
                        }`}
                        style={{ width: `${progress}%` }}
                      >
                         {/* Shimmer effect inside the bar */}
                         {!isComplete && progress > 0 && (
                           <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                         )}
                      </div>
                    </div>
                    <div className="mt-2 text-right text-[11px] tabular text-ink-faint">
                      {published} of {total} articles live
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      ) : null}

      {pagination && pagination.pages > 1 ? (
        <div className="flex items-center justify-center gap-4 pt-8">
          <Button
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="hover:text-ink transition-colors"
          >
            ← Previous
          </Button>
          <div className="px-4 py-1.5 rounded-full bg-panel-raised border border-hairline text-sm font-medium text-ink-secondary">
            Page {page} <span className="text-ink-faint">/</span> {pagination.pages}
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= pagination.pages}
            onClick={() => setPage((p) => p + 1)}
            className="hover:text-ink transition-colors"
          >
            Next →
          </Button>
        </div>
      ) : null}

      <AgentChatWidget agents={['cluster_agent']} defaultAgent="cluster_agent" />
    </div>
  );
}
