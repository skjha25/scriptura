// frontend/src/pages/ClusterDetailPage.js
/**
 * Cluster detail — shows all keywords in a cluster with:
 * - Generation date (mandatory for autopilot) with time-slot validation
 * - Publish date (optional)
 * - Status badges, assigned blog links
 * - Bulk auto-schedule modal
 * - Autopilot status indicator
 *
 * All dates displayed in IST (Asia/Kolkata), 12-hour format for readability.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';

import { clustersApi } from '../lib/api';
import { humanizeEnum, CLUSTER_KEYWORD_STATUS_META } from '../lib/constants';
import AgentChatWidget from '../components/agents/AgentChatWidget';
import Button from '../components/ui/Button';
import {
  Badge,
  Card,
  EmptyState,
  ErrorBanner,
  Skeleton,
  StatusBadge,
} from '../components/ui/feedback';

// ---------------------------------------------------------------------------
// Date formatting helpers — IST, 12-hour, human-friendly
// ---------------------------------------------------------------------------

const IST_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const IST_SHORT = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function formatDateIST(dateStr) {
  if (!dateStr) return null;
  try {
    return IST_FORMATTER.format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

function formatDateShort(dateStr) {
  if (!dateStr) return null;
  try {
    return IST_SHORT.format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

/** Convert a Date or ISO string to datetime-local input value (IST). */
function toLocalInput(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  // Offset to IST (+5:30)
  const ist = new Date(d.getTime() + (5.5 * 60 * 60 * 1000));
  return ist.toISOString().slice(0, 16);
}

/** Convert datetime-local value back to ISO (treating input as IST). */
function fromLocalInput(localStr) {
  if (!localStr) return null;
  // datetime-local gives us "2026-08-15T10:00" — treat as IST
  return `${localStr}:00+05:30`;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ClusterDetailPage() {
  const { id } = useParams();
  const [cluster, setCluster] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanding, setExpanding] = useState(false);
  const [expandError, setExpandError] = useState(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCluster(await clustersApi.get(id));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleExpand() {
    if (expanding) return;
    setExpanding(true);
    setExpandError(null);
    try {
      await clustersApi.expand(id, { count: 8 });
      await load();
    } catch (err) {
      setExpandError(err);
    } finally {
      setExpanding(false);
    }
  }

  async function handleStatusChange(newStatus) {
    try {
      await clustersApi.update(id, { status: newStatus });
      setCluster((prev) => ({ ...prev, status: newStatus }));
    } catch (err) {
      setError(err);
    }
  }

  const handleKeywordUpdate = useCallback((updatedKw) => {
    setCluster((prev) => ({
      ...prev,
      keywords: prev.keywords.map((k) => (k.id === updatedKw.id ? { ...k, ...updatedKw } : k)),
    }));
  }, []);

  const handleKeywordDelete = useCallback((deletedId) => {
    setCluster((prev) => ({
      ...prev,
      keywords: prev.keywords.filter((k) => k.id !== deletedId),
    }));
  }, []);

  if (loading && !cluster) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Card className="p-5"><Skeleton rows={4} /></Card>
      </div>
    );
  }

  if (error && !cluster) {
    return <ErrorBanner error={error} onRetry={load} />;
  }

  if (!cluster) return null;

  const keywords = cluster.keywords || [];
  const blogs = cluster.blogs || [];
  const scheduledCount = keywords.filter((k) => k.status === 'scheduled').length;
  const generatedCount = keywords.filter((k) => k.status === 'generated' || k.status === 'published').length;
  const nextScheduled = keywords
    .filter((k) => k.scheduled_generation_date && k.status === 'pending')
    .sort((a, b) => new Date(a.scheduled_generation_date) - new Date(b.scheduled_generation_date))[0];

  return (
    <div className="space-y-8 animate-fade-in-up relative z-0 pb-10">
      {/* Aurora Ambient Mesh Background */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-cosmic-wash opacity-40 blur-3xl mix-blend-screen" />

      {/* Header */}
      <header className="space-y-4">
        <Link to="/clusters" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-accent transition-colors">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Clusters
        </Link>
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 relative">
          <div className="space-y-2 relative pl-5">
            <div className="absolute left-0 top-0 h-full w-1 rounded-r-md bg-glow-accent opacity-75" />
            <h1 className="text-4xl font-bold tracking-tight text-ink drop-shadow-md">
              {cluster.name}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-sm text-ink-secondary">
              <span className="flex items-center gap-1.5">
                <svg className="h-4 w-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                </svg>
                Head keyword: <span className="font-semibold text-ink">{cluster.head_keyword}</span>
              </span>
              {cluster.is_seasonal && (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent-violet/10 px-2 py-0.5 text-xs text-accent-violet border border-accent-violet/20">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                  Seasonal (peak: {cluster.seasonal_peak_date})
                </span>
              )}
            </div>
          </div>
          <Badge tone={CLUSTER_KEYWORD_STATUS_META[cluster.status]?.tone || 'neutral'} className="text-base px-3 py-1 shadow-glow-sm">
            {humanizeEnum(cluster.status)}
          </Badge>
        </div>
      </header>

      {/* Overview & Actions Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Autopilot status bar */}
        <div className="lg:col-span-2 rounded-2xl border border-hairline bg-panel-raised/50 p-6 shadow-panel backdrop-blur-md relative overflow-hidden">
          <div className="absolute inset-0 bg-glow-subtle opacity-10 pointer-events-none" />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-ink-muted">Cluster Progress</h3>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <span className="font-numeric text-ink font-medium">{keywords.length} <span className="text-ink-muted font-sans font-normal">keywords</span></span>
                <span className="text-ink-faint hidden sm:inline">•</span>
                <span className="font-numeric text-accent-bright font-medium">{scheduledCount} <span className="text-ink-muted font-sans font-normal">scheduled</span></span>
                <span className="text-ink-faint hidden sm:inline">•</span>
                <span className="font-numeric text-status-good font-medium">{generatedCount} <span className="text-ink-muted font-sans font-normal">published</span></span>
              </div>
              {nextScheduled && (
                <div className="mt-2 text-xs font-medium text-accent-bright flex items-center gap-1.5">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Next generation: {formatDateShort(nextScheduled.scheduled_generation_date)}
                </div>
              )}
            </div>
            
            <div className="flex items-center justify-start sm:justify-end">
              {cluster.status === 'active' ? (
                <div className="inline-flex items-center gap-2 rounded-full bg-status-good/10 border border-status-good/20 px-3 py-1.5 text-sm font-medium text-status-good shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-good opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-status-good"></span>
                  </span>
                  Autopilot Active
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 rounded-full bg-void/50 border border-hairline px-3 py-1.5 text-sm text-ink-muted">
                  <span className="h-2 w-2 rounded-full bg-ink-faint" />
                  Autopilot Paused
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Actions bar */}
        <div className="rounded-2xl border border-hairline bg-panel-raised/50 p-6 shadow-panel backdrop-blur-md flex flex-col justify-center gap-3">
          <Button
            variant="primary"
            className="w-full shadow-glow-sm hover:shadow-glow transition-shadow"
            onClick={handleExpand}
            loading={expanding}
          >
            {expanding ? 'Expanding...' : 'Expand cluster (AI)'}
          </Button>
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="secondary"
              className="w-full hover:text-accent-bright transition-colors"
              onClick={() => setShowScheduleModal(true)}
              disabled={keywords.filter((k) => k.status === 'pending').length === 0}
            >
              ⚡ Auto-Schedule
            </Button>
            {cluster.status === 'planning' ? (
              <Button variant="secondary" className="w-full" onClick={() => handleStatusChange('active')}>
                Activate
              </Button>
            ) : cluster.status === 'active' ? (
              <Button variant="ghost" className="w-full border border-hairline bg-void/30" onClick={() => handleStatusChange('paused')}>
                Pause
              </Button>
            ) : cluster.status === 'paused' ? (
              <Button variant="secondary" className="w-full text-status-good hover:text-status-good/80" onClick={() => handleStatusChange('active')}>
                Resume
              </Button>
            ) : (
               <Button variant="ghost" className="w-full opacity-0 pointer-events-none">_</Button>
            )}
          </div>
        </div>
      </div>

      {expandError ? <ErrorBanner error={expandError} onDismiss={() => setExpandError(null)} /> : null}
      {error ? <ErrorBanner error={error} onDismiss={() => setError(null)} /> : null}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Keyword list */}
        <div className="xl:col-span-2 space-y-4">
          <div className="rounded-2xl border border-hairline bg-panel-raised/40 shadow-panel backdrop-blur-sm overflow-hidden">
            <div className="border-b border-hairline px-6 py-5 bg-void/30">
              <h2 className="text-lg font-semibold text-ink">Cluster Keywords</h2>
              <p className="text-sm text-ink-muted mt-1">Each keyword becomes one article. Set generation date to enable autopilot.</p>
            </div>
            {keywords.length === 0 ? (
              <div className="px-6 py-12">
                <EmptyState
                  icon={<span className="text-4xl text-accent drop-shadow-glow">✨</span>}
                  title="No keywords yet"
                  message="Click 'Expand cluster (AI)' to magically generate related sub-keywords for this topic."
                />
              </div>
            ) : (
              <ul className="divide-y divide-hairline">
                {keywords.map((kw) => (
                  <KeywordListItem
                    key={kw.id}
                    kw={kw}
                    clusterId={id}
                    onUpdate={handleKeywordUpdate}
                    onDelete={handleKeywordDelete}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Associated blogs */}
        <div className="space-y-4">
          {blogs.length > 0 ? (
            <div className="rounded-2xl border border-hairline bg-panel-raised/40 shadow-panel backdrop-blur-sm overflow-hidden">
              <div className="border-b border-hairline px-6 py-5 bg-void/30">
                <h2 className="text-lg font-semibold text-ink">Generated Blogs</h2>
                <p className="text-sm text-ink-muted mt-1">Articles produced in this cluster.</p>
              </div>
              <ul className="divide-y divide-hairline max-h-[600px] overflow-y-auto custom-scrollbar">
                {blogs.map((blog) => (
                  <li key={blog.id} className="flex items-center justify-between gap-3 px-6 py-4 hover:bg-white/[0.02] transition-colors group">
                    <Link to={`/blogs/${blog.id}`} className="min-w-0 flex-1 truncate text-sm font-medium text-ink group-hover:text-accent-bright transition-colors">
                      {blog.blog_title}
                    </Link>
                    <StatusBadge status={blog.blog_status} />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-2xl border border-hairline bg-panel-raised/20 shadow-inner backdrop-blur-sm overflow-hidden p-6 text-center">
               <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-void border border-hairline mb-3">
                 <svg className="h-6 w-6 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9.5a2.5 2.5 0 00-2.5-2.5H15" />
                 </svg>
               </div>
               <h3 className="text-sm font-medium text-ink">No blogs generated</h3>
               <p className="text-xs text-ink-muted mt-1">When autopilot runs, articles will appear here.</p>
            </div>
          )}
        </div>
      </div>

      {/* Auto-Schedule Modal */}
      {showScheduleModal ? (
        <AutoScheduleModal
          clusterId={id}
          cluster={cluster}
          onClose={() => setShowScheduleModal(false)}
          onApplied={load}
        />
      ) : null}

      <AgentChatWidget agents={['cluster_agent']} defaultAgent="cluster_agent" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keyword list item with dual date editing + time-slot validation
// ---------------------------------------------------------------------------

function KeywordListItem({ kw, clusterId, onUpdate, onDelete }) {
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [genDate, setGenDate] = useState(toLocalInput(kw.scheduled_generation_date));
  const [pubDate, setPubDate] = useState(toLocalInput(kw.suggested_publish_date));
  const [slotStatus, setSlotStatus] = useState(null); // null | 'checking' | 'available' | {conflict}

  const meta = CLUSTER_KEYWORD_STATUS_META[kw.status] || { label: kw.status, tone: 'neutral', icon: '' };
  const isLocked = ['generating', 'generated', 'published'].includes(kw.status);

  // Check time-slot availability when generation date changes
  async function checkSlot(dateValue) {
    if (!dateValue) { setSlotStatus(null); return; }
    const iso = fromLocalInput(dateValue);
    setSlotStatus('checking');
    try {
      const result = await clustersApi.checkTimeSlot(iso, kw.id);
      setSlotStatus(result.available ? 'available' : result.conflict);
    } catch {
      setSlotStatus(null);
    }
  }

  function handleGenDateChange(e) {
    const val = e.target.value;
    setGenDate(val);
    checkSlot(val);
  }

  async function handleSave() {
    setLoading(true);
    try {
      const payload = {
        scheduled_generation_date: genDate ? fromLocalInput(genDate) : null,
        suggested_publish_date: pubDate ? fromLocalInput(pubDate) : null,
      };
      const updated = await clustersApi.updateKeyword(clusterId, kw.id, payload);
      onUpdate(updated);
      setIsEditing(false);
      setSlotStatus(null);
    } catch (err) {
      alert(err.message || 'Failed to update keyword');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm('Are you sure you want to delete this keyword?')) return;
    setLoading(true);
    try {
      await clustersApi.removeKeyword(clusterId, kw.id);
      onDelete(kw.id);
    } catch (err) {
      alert(err.message || 'Failed to delete keyword');
      setLoading(false);
    }
  }

  function handleExpand() {
    setGenDate(toLocalInput(kw.scheduled_generation_date));
    setPubDate(toLocalInput(kw.suggested_publish_date));
    setSlotStatus(null);
    setIsEditing(true);
  }

  const hasConflict = slotStatus && typeof slotStatus === 'object' && slotStatus.keyword;

  return (
    <li className="px-6 py-4 hover:bg-white/[0.02] transition-colors group">
      <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
        {/* Left: keyword + schedule info */}
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-base font-semibold text-ink group-hover:text-accent-bright transition-colors">{kw.keyword}</span>
            <Badge tone={meta.tone} className="shadow-sm">
              {meta.icon} {meta.label}
            </Badge>
            <span className="inline-flex items-center gap-1 rounded-full bg-void/50 px-2 py-0.5 text-[10px] uppercase tracking-wider font-medium text-ink-muted border border-hairline">
              {humanizeEnum(kw.search_intent)}
            </span>
          </div>

          {/* Date display (when not editing) */}
          {!isEditing ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
              <span className="inline-flex items-center gap-1.5 text-ink-secondary">
                <span className="text-accent/80">🤖 Generate:</span>
                {kw.scheduled_generation_date ? (
                  <span className="font-numeric font-medium text-ink">{formatDateIST(kw.scheduled_generation_date)}</span>
                ) : (
                  <span className="text-ink-faint italic">Not configured</span>
                )}
              </span>
              <span className="inline-flex items-center gap-1.5 text-ink-secondary">
                <span className="text-status-good/80">📤 Publish:</span>
                {kw.suggested_publish_date ? (
                  <span className="font-numeric font-medium text-ink">{formatDateIST(kw.suggested_publish_date)}</span>
                ) : (
                  <span className="text-ink-faint italic">Manual</span>
                )}
              </span>
              {!isLocked && (
                <button
                  onClick={handleExpand}
                  className="text-xs font-medium text-accent hover:text-accent-bright transition-colors inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit schedule
                </button>
              )}
            </div>
          ) : (
            /* Editing mode */
            <div className="space-y-4 rounded-xl border border-hairline bg-void/60 p-4 shadow-inner mt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Generation date */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-ink-secondary flex items-center gap-1">
                    <span className="text-accent">🤖</span> Generate Schedule
                  </label>
                  <div className="relative">
                    <input
                      type="datetime-local"
                      className="w-full text-sm px-3 py-2 border border-hairline rounded-lg bg-panel-raised text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                      value={genDate}
                      onChange={handleGenDateChange}
                    />
                    <div className="absolute right-0 top-full mt-1 flex justify-end w-full">
                      {slotStatus === 'checking' && (
                        <span className="text-[10px] text-ink-muted animate-pulse">Checking availability...</span>
                      )}
                      {slotStatus === 'available' && (
                        <span className="text-[10px] text-status-good font-medium">✅ Slot available</span>
                      )}
                      {hasConflict && (
                        <span className="text-[10px] text-status-critical font-medium bg-status-critical/10 px-1.5 py-0.5 rounded border border-status-critical/20">
                          ⚠️ Taken by: {slotStatus.keyword}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Publish date */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-ink-secondary flex items-center justify-between">
                    <span className="flex items-center gap-1"><span className="text-status-good">📤</span> Publish Schedule</span>
                    <span className="text-[10px] font-normal text-ink-faint">(Optional)</span>
                  </label>
                  <input
                    type="datetime-local"
                    className="w-full text-sm px-3 py-2 border border-hairline rounded-lg bg-panel-raised text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                    value={pubDate}
                    onChange={(e) => setPubDate(e.target.value)}
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  disabled={loading}
                  onClick={() => { setIsEditing(false); setSlotStatus(null); }}
                  className="text-xs px-4 py-1.5 rounded-lg border border-hairline bg-panel-raised text-ink-muted hover:text-ink hover:bg-white/5 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  disabled={loading || hasConflict}
                  onClick={handleSave}
                  className="text-xs font-medium px-4 py-1.5 rounded-lg bg-accent text-white shadow-glow-sm hover:shadow-glow hover:bg-accent-bright transition-all disabled:opacity-50 disabled:shadow-none"
                >
                  {loading ? 'Saving...' : 'Confirm Schedule'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: blog link + delete */}
        <div className="flex xl:flex-col items-center xl:items-end justify-between xl:justify-start gap-4 xl:gap-2 mt-4 xl:mt-0 border-t border-hairline xl:border-0 pt-4 xl:pt-0">
          {kw.assignedBlog ? (
            <Link
              to={`/blogs/${kw.assignedBlog.id}`}
              className="group/link flex items-center gap-2 rounded-lg bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent-bright border border-accent/20 hover:bg-accent/20 transition-colors max-w-[200px]"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="truncate">{kw.assignedBlog.blog_title}</span>
            </Link>
          ) : (
            <div className="text-xs text-ink-faint italic hidden xl:block">No blog assigned</div>
          )}
          
          {!isLocked && (
            <button
              onClick={handleDelete}
              disabled={loading}
              className="inline-flex items-center justify-center p-1.5 rounded-md text-ink-faint hover:text-status-critical hover:bg-status-critical/10 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
              title="Remove keyword"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Auto-Schedule Modal
// ---------------------------------------------------------------------------

function AutoScheduleModal({ clusterId, cluster, onClose, onApplied }) {
  const [startDate, setStartDate] = useState('');
  const [postsPerWeek, setPostsPerWeek] = useState(cluster.cadence_posts_per_week || 2);
  const [preferredTime, setPreferredTime] = useState('10:00');
  const [bufferDays, setBufferDays] = useState(2);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState(null);

  async function handlePreview() {
    if (!startDate) return;
    setLoading(true);
    setError(null);
    try {
      const result = await clustersApi.autoSchedule(clusterId, {
        start_date: fromLocalInput(startDate),
        posts_per_week: postsPerWeek,
        preferred_time: preferredTime,
        buffer_days: bufferDays,
      });
      setPreview(result.schedule);
    } catch (err) {
      setError(err.message || 'Failed to generate schedule preview.');
    } finally {
      setLoading(false);
    }
  }

  async function handleApply() {
    if (!preview || preview.length === 0) return;
    setApplying(true);
    setError(null);
    try {
      await clustersApi.scheduleAll(clusterId, {
        keywords: preview.map((item) => ({
          id: item.id,
          scheduled_generation_date: item.scheduled_generation_date,
          suggested_publish_date: item.suggested_publish_date,
        })),
      });
      onApplied();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to apply schedule.');
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4 text-center sm:p-6">
        {/* Backdrop */}
        <div className="fixed inset-0 bg-void/80 backdrop-blur-sm transition-opacity" onClick={onClose} />
        
        {/* Modal Panel */}
        <div className="relative w-full max-w-2xl transform text-left rounded-2xl bg-panel-raised border border-hairline shadow-panel overflow-hidden animate-fade-in-up flex flex-col max-h-[90vh]">
          <div className="absolute inset-0 bg-glow-subtle opacity-10 pointer-events-none" />
          
          {/* Header */}
          <div className="border-b border-hairline px-6 py-5 bg-void/50 relative z-10 shrink-0">
            <h2 className="text-xl font-bold text-ink drop-shadow-md flex items-center gap-2">
              <span className="text-accent-bright">⚡</span> Auto-Schedule Keywords
            </h2>
            <p className="text-sm text-ink-muted mt-1.5">
              Automatically space out generation and publishing dates for all pending keywords across the cluster.
            </p>
          </div>

          {/* Form Content (Scrollable if needed) */}
          <div className="space-y-6 px-6 py-6 relative z-10 overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink-secondary">Start from</label>
              <input
                type="datetime-local"
                className="w-full text-sm px-3 py-2.5 border border-hairline rounded-lg bg-void/50 text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all shadow-inner"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink-secondary">Posts per week</label>
              <select
                className="w-full text-sm px-3 py-2.5 border border-hairline rounded-lg bg-void/50 text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all shadow-inner"
                value={postsPerWeek}
                onChange={(e) => setPostsPerWeek(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5, 7].map((n) => (
                  <option key={n} value={n}>{n} post{n > 1 ? 's' : ''} / week</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink-secondary">Preferred time (IST)</label>
              <input
                type="time"
                className="w-full text-sm px-3 py-2.5 border border-hairline rounded-lg bg-void/50 text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all shadow-inner"
                value={preferredTime}
                onChange={(e) => setPreferredTime(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink-secondary">Publish buffer</label>
              <select
                className="w-full text-sm px-3 py-2.5 border border-hairline rounded-lg bg-void/50 text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all shadow-inner"
                value={bufferDays}
                onChange={(e) => setBufferDays(Number(e.target.value))}
              >
                {[1, 2, 3, 5, 7].map((n) => (
                  <option key={n} value={n}>{n} day{n > 1 ? 's' : ''} after generation</option>
                ))}
              </select>
            </div>
          </div>

          <div className="pt-2 border-t border-hairline/50">
            <Button variant="secondary" className="w-full sm:w-auto" onClick={handlePreview} loading={loading} disabled={!startDate}>
              {loading ? 'Computing optimal schedule...' : 'Generate Preview'}
            </Button>
          </div>

          {error && (
            <div className="rounded-lg bg-status-critical/10 border border-status-critical/20 p-3 text-sm text-status-critical flex items-start gap-2">
              <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              {error}
            </div>
          )}

          {/* Preview table */}
          {preview && preview.length > 0 && (
            <div className="max-h-[240px] overflow-y-auto border border-hairline rounded-xl bg-void/30 custom-scrollbar shadow-inner mt-4">
              <table className="w-full text-sm">
                <thead className="bg-panel-raised/80 sticky top-0 backdrop-blur-sm z-20">
                  <tr>
                    <th className="text-left px-4 py-3 text-ink-muted font-semibold w-12 border-b border-hairline">#</th>
                    <th className="text-left px-4 py-3 text-ink-muted font-semibold border-b border-hairline">Keyword</th>
                    <th className="text-left px-4 py-3 text-ink-muted font-semibold border-b border-hairline">Generation</th>
                    <th className="text-left px-4 py-3 text-ink-muted font-semibold border-b border-hairline">Publishing</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {preview.map((item, i) => (
                    <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 text-ink-faint font-numeric">{i + 1}</td>
                      <td className="px-4 py-3 text-ink font-medium max-w-[180px] truncate" title={item.keyword}>{item.keyword}</td>
                      <td className="px-4 py-3 text-ink-secondary font-numeric">{formatDateShort(item.scheduled_generation_date)}</td>
                      <td className="px-4 py-3 text-ink-secondary font-numeric">{formatDateShort(item.suggested_publish_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-4 border-t border-hairline px-6 py-4 bg-void/50 relative z-10 shrink-0">
          <Button variant="ghost" onClick={onClose} className="hover:bg-white/5">Cancel</Button>
          <Button
            variant="primary"
            onClick={handleApply}
            loading={applying}
            disabled={!preview || preview.length === 0}
            className="shadow-glow-sm hover:shadow-glow transition-shadow"
          >
            {applying ? 'Applying...' : `Confirm & Apply (${preview?.length || 0})`}
          </Button>
        </div>
      </div>
      </div>
    </div>
  );
}
