/**
 * frontend/src/pages/SettingsPage.js
 *
 * Trending Topics — manage the topic pool used by Automated AI Blog engine.
 * Fully migrated to the Scriptura design system.
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { settingsApi } from '../lib/api';
import Button from '../components/ui/Button';
import { Input } from '../components/ui/form';
import { Card, CardHeader, ErrorBanner, EmptyState, Skeleton } from '../components/ui/feedback';
import { PAGE_ENTER, STAGGER_CONTAINER, STAGGER_CHILD, LIST_CHILD } from '../lib/motion';

export default function SettingsPage() {
  const [topics, setTopics] = useState([]);
  const [newTopic, setNewTopic] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const [suggestedTopics, setSuggestedTopics] = useState([]);
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => { fetchTopics(); }, []);

  const fetchTopics = async () => {
    try {
      setLoading(true);
      const data = await settingsApi.getTopics();
      setTopics(data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddTopic = async (topicText, e) => {
    if (e) e.preventDefault();
    if (!topicText.trim()) return;
    try {
      setSubmitting(true);
      setActionError(null);
      const added = await settingsApi.addTopic({ topic: topicText.trim() });
      setTopics([added, ...topics]);
      if (topicText === newTopic) setNewTopic('');
      setSuggestedTopics(suggestedTopics.filter(t => t !== topicText.trim()));
    } catch (err) {
      setActionError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      setActionError(null);
      await settingsApi.deleteTopic(id);
      setTopics(topics.filter((t) => t.id !== id));
    } catch (err) {
      setActionError(err);
    }
  };

  const handleSuggestTopics = async () => {
    try {
      setSuggesting(true);
      setActionError(null);
      const data = await settingsApi.suggestTopics();
      setSuggestedTopics(data);
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
            Trending Topics
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Manage the astrology topics used by the Automated AI Blog engine.
          </p>
        </div>
      </header>

      {error ? <ErrorBanner error={error} onRetry={fetchTopics} /> : null}
      {actionError ? <ErrorBanner error={actionError} onDismiss={() => setActionError(null)} /> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* AI Suggestions panel */}
        <Card className="flex flex-col">
          <CardHeader
            title="AI Auto-Suggest"
            subtitle="Real-time analysis of trending astrology topics based on current events and search volume."
            action={
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleSuggestTopics}
                disabled={suggesting}
                loading={suggesting}
              >
                {suggesting ? 'Analyzing…' : 'Suggest Topics'}
              </Button>
            }
          />
          <div className="flex-1 px-5 pb-5 pt-4">
            <div className="space-y-2 max-h-[420px] overflow-y-auto">
              {suggesting ? (
                <div className="space-y-2 py-4">
                  {[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : suggestedTopics.length === 0 ? (
                <div className="rounded-lg border border-hairline bg-panel-sunken px-4 py-8 text-center">
                  <p className="text-sm text-ink-muted">
                    Click "Suggest Topics" to see real-time trends.
                  </p>
                </div>
              ) : (
                <motion.ul
                  variants={STAGGER_CONTAINER}
                  initial="initial"
                  animate="animate"
                  className="space-y-2"
                >
                  <AnimatePresence>
                    {suggestedTopics.map((topic, i) => (
                      <motion.li
                        key={topic}
                        variants={STAGGER_CHILD}
                        exit={{ opacity: 0, x: 8, transition: { duration: 0.2 } }}
                        className="flex items-center justify-between gap-3 rounded-lg border border-brand/20 bg-brand-subtle px-4 py-2.5"
                      >
                        <span className="text-sm font-medium text-ink">{topic}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleAddTopic(topic)}
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

        {/* Active topics panel */}
        <Card className="flex flex-col">
          <CardHeader
            title="Active Topic Database"
            subtitle='When "Start Generating" is clicked, the system randomly picks one of these as the primary keyword.'
          />
          <div className="flex-1 px-5 pb-5 pt-4 space-y-4">
            <form onSubmit={(e) => handleAddTopic(newTopic, e)} className="flex gap-3">
              <Input
                value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                placeholder="e.g., Diwali Puja Astrology…"
                disabled={submitting}
                containerClassName="flex-1"
              />
              <Button
                type="submit"
                variant="primary"
                disabled={!newTopic.trim() || submitting}
                loading={submitting}
                className="shrink-0"
              >
                Add
              </Button>
            </form>

            <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
              {loading ? (
                <div className="space-y-2 py-4">
                  {[1,2,3,4].map(i => <Skeleton key={i} className="h-11 w-full" />)}
                </div>
              ) : topics.length === 0 ? (
                <EmptyState
                  icon="✧"
                  title="No topics yet"
                  message="Add topics manually or use AI Auto-Suggest to populate the list."
                />
              ) : (
                <AnimatePresence initial={false}>
                  {topics.map((t) => (
                    <motion.div
                      key={t.id}
                      variants={LIST_CHILD}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-panel-raised px-4 py-2.5 transition-colors hover:border-hairline-strong"
                    >
                      <span className="text-sm font-medium text-ink truncate">{t.topic}</span>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={() => handleDelete(t.id)}
                        className="shrink-0"
                      >
                        Remove
                      </Button>
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
