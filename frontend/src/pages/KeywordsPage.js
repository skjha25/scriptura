// frontend/src/pages/KeywordsPage.js
import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ChevronLeft, ChevronRight } from 'lucide-react';

import { keywordsApi, clustersApi } from '../lib/api';
import Button from '../components/ui/Button';
import { Input } from '../components/ui/form';
import { Card, CardHeader, Badge, ErrorBanner, EmptyState, Skeleton } from '../components/ui/feedback';
import AgentChatWidget from '../components/agents/AgentChatWidget';

const STATUS_TONE = { not_used: 'accent', in_progress: 'warning' };
const PAGE_SIZE = 20;

export default function KeywordsPage() {
  const navigate = useNavigate();
  const [keywords, setKeywords] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [newKeyword, setNewKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const [suggestedKeywords, setSuggestedKeywords] = useState([]);
  const [suggesting, setSuggesting] = useState(false);
  const [topicForSuggestion, setTopicForSuggestion] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await keywordsApi.list({ page, limit: PAGE_SIZE });
      setKeywords(res.data || []);
      setPagination(res.pagination || null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAddKeyword = async (keywordText, e) => {
    if (e) e.preventDefault();
    if (!keywordText.trim()) return;

    try {
      setSubmitting(true);
      setError(null);
      const added = await keywordsApi.create({ primary_keyword: keywordText.trim() });
      setKeywords((prev) => [added, ...(prev || [])]);
      if (keywordText === newKeyword) setNewKeyword('');
      setSuggestedKeywords((prev) => prev.filter((k) => k !== keywordText.trim()));
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      setError(null);
      await keywordsApi.remove(id);
      setKeywords((prev) => (prev || []).filter((k) => k.id !== id));
    } catch (err) {
      setError(err);
    }
  };

  const handleSuggestKeywords = async (e) => {
    e.preventDefault();
    if (!topicForSuggestion.trim()) return;

    try {
      setSuggesting(true);
      setError(null);
      const data = await keywordsApi.suggest(topicForSuggestion);
      setSuggestedKeywords(data || []);
    } catch (err) {
      setError(err);
    } finally {
      setSuggesting(false);
    }
  };

  const handleExpand = async (keyword) => {
    try {
      const cluster = await clustersApi.create({
        name: `${keyword.primary_keyword} cluster`,
        head_keyword: keyword.primary_keyword,
        keywords: (keyword.secondary_keywords || []).map((sk) => ({ keyword: sk })),
      });
      navigate(`/clusters/${cluster.id}`);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <motion.div
      className="space-y-8"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <header>
        <h1 className="font-display text-3xl font-semibold text-ink sm:text-4xl">Keyword Pool</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Manage your SEO keyword pool. Autopilot will pick from this list automatically.
        </p>
      </header>

      {error ? <ErrorBanner error={error} onRetry={load} onDismiss={() => setError(null)} /> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card as="section">
          <CardHeader title="Keyword Suggestions" subtitle="Ask AI for keyword ideas by entering a broad topic." />
          <div className="px-5 pb-5 pt-2">
            <form onSubmit={handleSuggestKeywords} className="mb-4 flex gap-2">
              <Input
                type="text"
                containerClassName="flex-1"
                placeholder="e.g., Vedic Astrology…"
                value={topicForSuggestion}
                onChange={(e) => setTopicForSuggestion(e.target.value)}
                disabled={suggesting}
              />
              <Button type="submit" variant="primary" disabled={suggesting || !topicForSuggestion.trim()} loading={suggesting}>
                <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                {suggesting ? 'Fetching…' : 'Suggest'}
              </Button>
            </form>

            <div className="space-y-2.5">
              {suggesting ? (
                <Skeleton rows={3} />
              ) : suggestedKeywords.length === 0 ? (
                <EmptyState title="No suggestions yet" message="Enter a topic above and suggestions appear here." />
              ) : (
                <AnimatePresence initial={false}>
                  {suggestedKeywords.map((kw) => (
                    <motion.div
                      key={kw}
                      layout
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 12 }}
                      className="flex items-center justify-between rounded-lg border border-accent/25 bg-accent/5 px-3 py-2"
                    >
                      <span className="text-sm font-medium text-ink">{kw}</span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => handleAddKeyword(kw)} disabled={submitting}>
                        Add
                      </Button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </div>
        </Card>

        <Card as="section">
          <CardHeader
            title="Active Keyword Pool"
            subtitle="Keywords waiting to be processed by Autopilot."
          />
          <div className="px-5 pb-5 pt-2">
            <form onSubmit={(e) => handleAddKeyword(newKeyword, e)} className="mb-4 flex gap-2">
              <Input
                type="text"
                containerClassName="flex-1"
                placeholder="e.g., best horoscopes 2026"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                disabled={submitting}
              />
              <Button type="submit" variant="primary" disabled={!newKeyword.trim() || submitting} loading={submitting}>
                Add
              </Button>
            </form>

            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {loading && !keywords ? (
                <Skeleton rows={4} />
              ) : !keywords || keywords.length === 0 ? (
                <EmptyState title="No keywords yet" message="Add one above, or generate suggestions on the left." />
              ) : (
                <AnimatePresence initial={false}>
                  {keywords.map((k) => (
                    <motion.div
                      key={k.id}
                      layout
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-panel-raised/50 px-3 py-2 transition-colors hover:border-hairline-strong"
                    >
                      <div className="min-w-0">
                        <span className="text-sm text-ink">{k.primary_keyword}</span>
                        <Badge tone={STATUS_TONE[k.status] || 'good'} className="ml-2">
                          {k.status.replace('_', ' ')}
                        </Badge>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button type="button" variant="ghost" size="sm" onClick={() => handleExpand(k)}>
                          Expand to Cluster
                        </Button>
                        <Button type="button" variant="danger" size="sm" onClick={() => handleDelete(k.id)}>
                          Remove
                        </Button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>

            {pagination && pagination.pages > 1 ? (
              <div className="mt-4 flex items-center justify-center gap-3">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Previous
                </Button>
                <span className="text-xs text-ink-muted">
                  Page {page} of {pagination.pages}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page >= pagination.pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                </Button>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <AgentChatWidget agents={['research_agent']} defaultAgent="research_agent" />
    </motion.div>
  );
}
