/**
 * frontend/src/pages/KeywordsPage.js
 *
 * Keyword Pool — manage and suggest SEO keywords.
 * Fully migrated to the Scriptura design system.
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { keywordsApi, clustersApi } from '../lib/api';
import Button from '../components/ui/Button';
import { Input } from '../components/ui/form';
import { Card, CardHeader, Badge, ErrorBanner, EmptyState, Skeleton } from '../components/ui/feedback';
import { PAGE_ENTER, STAGGER_CONTAINER, STAGGER_CHILD, LIST_CHILD } from '../lib/motion';

const STATUS_TONES = {
  not_used: 'accent',
  in_progress: 'warning',
  used: 'good',
};

const STATUS_LABELS = {
  not_used: 'Unused',
  in_progress: 'In progress',
  used: 'Used',
};

export default function KeywordsPage() {
  const navigate = useNavigate();
  const [keywords, setKeywords] = useState([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const [suggestedKeywords, setSuggestedKeywords] = useState([]);
  const [suggesting, setSuggesting] = useState(false);
  const [topicForSuggestion, setTopicForSuggestion] = useState('');

  useEffect(() => { fetchKeywords(); }, []);

  const fetchKeywords = async () => {
    try {
      setLoading(true);
      const res = await keywordsApi.list({ limit: 100 });
      setKeywords(res.data || []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddKeyword = async (keywordText, e) => {
    if (e) e.preventDefault();
    if (!keywordText.trim()) return;
    try {
      setSubmitting(true);
      setActionError(null);
      const added = await keywordsApi.create({ primary_keyword: keywordText.trim() });
      setKeywords([added, ...keywords]);
      if (keywordText === newKeyword) setNewKeyword('');
      setSuggestedKeywords(suggestedKeywords.filter(k => k !== keywordText.trim()));
    } catch (err) {
      setActionError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      setActionError(null);
      await keywordsApi.remove(id);
      setKeywords(keywords.filter((k) => k.id !== id));
    } catch (err) {
      setActionError(err);
    }
  };

  const handleSuggestKeywords = async (e) => {
    e.preventDefault();
    if (!topicForSuggestion.trim()) return;
    try {
      setSuggesting(true);
      setActionError(null);
      const data = await keywordsApi.suggest(topicForSuggestion);
      setSuggestedKeywords(data || []);
    } catch (err) {
      setActionError(err);
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <motion.div {...PAGE_ENTER} className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink" style={{ letterSpacing: '-0.02em' }}>
            Keyword Pool
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Manage your SEO keyword pool. Autopilot selects from this list automatically.
          </p>
        </div>
      </header>

      {error ? <ErrorBanner error={error} onRetry={fetchKeywords} /> : null}
      {actionError ? <ErrorBanner error={actionError} onDismiss={() => setActionError(null)} /> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Suggestions panel */}
        <Card className="flex flex-col">
          <CardHeader
            title="AI Keyword Suggestions"
            subtitle="Enter a broad topic and get AI-powered keyword ideas."
          />
          <div className="flex-1 px-5 pb-5 pt-4 space-y-4">
            <form onSubmit={handleSuggestKeywords} className="flex gap-3">
              <Input
                value={topicForSuggestion}
                onChange={(e) => setTopicForSuggestion(e.target.value)}
                placeholder="e.g., Vedic Astrology…"
                disabled={suggesting}
                containerClassName="flex-1"
              />
              <Button
                type="submit"
                variant="primary"
                disabled={suggesting || !topicForSuggestion.trim()}
                loading={suggesting}
                className="shrink-0"
              >
                {suggesting ? 'Fetching…' : 'Suggest'}
              </Button>
            </form>

            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {suggesting ? (
                <div className="space-y-2 py-4">
                  {[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : suggestedKeywords.length === 0 ? (
                <div className="rounded-lg border border-hairline bg-panel-sunken px-4 py-8 text-center">
                  <p className="text-sm text-ink-muted">Suggestions will appear here.</p>
                </div>
              ) : (
                <motion.ul
                  variants={STAGGER_CONTAINER}
                  initial="initial"
                  animate="animate"
                  className="space-y-2"
                >
                  <AnimatePresence>
                    {suggestedKeywords.map((kw, i) => (
                      <motion.li
                        key={kw}
                        variants={STAGGER_CHILD}
                        exit={{ opacity: 0, x: 8, transition: { duration: 0.2 } }}
                        className="flex items-center justify-between gap-3 rounded-lg border border-brand/20 bg-brand-subtle px-4 py-2.5"
                      >
                        <span className="text-sm font-medium text-ink">{kw}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleAddKeyword(kw)}
                          disabled={submitting}
                        >
                          Add
                        </Button>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </motion.ul>
              )}
            </div>
          </div>
        </Card>

        {/* Active pool panel */}
        <Card className="flex flex-col">
          <CardHeader
            title="Active Keyword Pool"
            subtitle="Keywords available for Autopilot to process."
          />
          <div className="flex-1 px-5 pb-5 pt-4 space-y-4">
            <form onSubmit={(e) => handleAddKeyword(newKeyword, e)} className="flex gap-3">
              <Input
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                placeholder="e.g., best horoscopes 2026"
                disabled={submitting}
                containerClassName="flex-1"
              />
              <Button
                type="submit"
                variant="primary"
                disabled={!newKeyword.trim() || submitting}
                loading={submitting}
                className="shrink-0"
              >
                Add
              </Button>
            </form>

            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
              {loading ? (
                <div className="space-y-2 py-4">
                  {[1,2,3,4].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : keywords.length === 0 ? (
                <EmptyState
                  icon="✦"
                  title="No keywords yet"
                  message="Add keywords above or use AI suggestions to get started."
                />
              ) : (
                <AnimatePresence initial={false}>
                  {keywords.map((k) => (
                    <motion.div
                      key={k.id}
                      variants={LIST_CHILD}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-panel-raised px-4 py-2.5 transition-colors hover:border-hairline-strong"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-sm font-medium text-ink truncate">
                          {k.primary_keyword}
                        </span>
                        <Badge tone={STATUS_TONES[k.status] || 'neutral'}>
                          {STATUS_LABELS[k.status] || k.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            try {
                              const cluster = await clustersApi.create({
                                name: `${k.primary_keyword} cluster`,
                                head_keyword: k.primary_keyword,
                                keywords: (k.secondary_keywords || []).map((sk) => ({ keyword: sk })),
                              });
                              navigate(`/clusters/${cluster.id}`);
                            } catch (err) {
                              setActionError(err);
                            }
                          }}
                        >
                          Expand
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          onClick={() => handleDelete(k.id)}
                        >
                          Remove
                        </Button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </div>
        </Card>
      </div>
    </motion.div>
  );
}
