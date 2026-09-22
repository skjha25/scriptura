import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { settingsApi } from '../lib/api';
import Button from '../components/ui/Button';
import { Input } from '../components/ui/form';
import { Card, CardHeader, ErrorBanner, Skeleton, EmptyState } from '../components/ui/feedback';
import AgentChatWidget from '../components/agents/AgentChatWidget';
import ImageDefaultsSettings from '../components/settings/ImageDefaultsSettings';
import FactVerificationSettings from '../components/settings/FactVerificationSettings';
import IntegrationsSettings from '../components/settings/IntegrationsSettings';

/**
 * SettingsPage
 *
 * Trending Topics: SEO executives and admins manage the dynamic topics used
 * by the Automated AI Blog generation tool, with AI-powered real-time trend
 * suggestions.
 *
 * Content Configuration (P6): global, org-wide generation defaults —
 * currently Blog Image Defaults; Fact Verification and Reusable Links/CTAs
 * join this section as later P6 sub-phases. These are consumed
 * automatically by Autopilot and every manual generation — see
 * ImageDefaultsSettings.js's own header comment.
 */
export default function SettingsPage() {
  const [topics, setTopics] = useState([]);
  const [newTopic, setNewTopic] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [suggestedTopics, setSuggestedTopics] = useState([]);
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    fetchTopics();
  }, []);

  const fetchTopics = async () => {
    try {
      setLoading(true);
      const data = await settingsApi.getTopics();
      setTopics(data);
    } catch (err) {
      setError(err.message || 'Failed to load topics.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddTopic = async (topicText, e) => {
    if (e) e.preventDefault();
    if (!topicText.trim()) return;

    try {
      setSubmitting(true);
      setError('');
      const added = await settingsApi.addTopic({ topic: topicText.trim() });
      setTopics([added, ...topics]);
      if (topicText === newTopic) {
        setNewTopic('');
      }

      // Remove from suggested if it was there
      setSuggestedTopics(suggestedTopics.filter(t => t !== topicText.trim()));
    } catch (err) {
      setError(err.message || 'Failed to add topic. It might already exist.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      setError('');
      await settingsApi.deleteTopic(id);
      setTopics(topics.filter((t) => t.id !== id));
    } catch (err) {
      setError(err.message || 'Failed to delete topic.');
    }
  };

  const handleSuggestTopics = async () => {
    try {
      setSuggesting(true);
      setError('');
      const data = await settingsApi.suggestTopics();
      setSuggestedTopics(data);
    } catch (err) {
      setError(err.message || 'Failed to suggest topics.');
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <motion.div
      className="space-y-8 animate-fade-in-up"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Settings</h1>
        <p className="max-w-2xl text-base text-ink-secondary">
          Platform-wide configuration — trending topics for Autopilot, and the content defaults every
          generation and manual edit draws on automatically.
        </p>
      </header>

      <section aria-labelledby="topics-heading" className="space-y-4">
        <h2 id="topics-heading" className="text-lg font-semibold text-ink">
          Trending Topics
        </h2>

        <ErrorBanner error={error ? { message: error } : null} onDismiss={() => setError('')} />

        <div className="grid gap-6 lg:grid-cols-2">
          <Card as="div">
            <CardHeader
              title="Auto Suggest (AI)"
              subtitle="Real-time analysis to suggest trending astrology topics based on current astrological events and search volume."
              action={
                <Button type="button" variant="primary" size="sm" onClick={handleSuggestTopics} disabled={suggesting} loading={suggesting}>
                  {suggesting ? 'Analyzing…' : 'Suggest Topics'}
                </Button>
              }
            />
            <div className="space-y-2.5 px-5 pb-5 pt-2">
              {suggesting ? (
                <Skeleton rows={3} />
              ) : suggestedTopics.length === 0 ? (
                <EmptyState title="No suggestions yet" message="Click “Suggest Topics” to see real-time trends." />
              ) : (
                <AnimatePresence initial={false}>
                  {suggestedTopics.map((topic, i) => (
                    <motion.div
                      key={topic}
                      layout
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 12 }}
                      transition={{ delay: i * 0.05, duration: 0.2 }}
                      className="flex items-center justify-between rounded-lg border border-accent/25 bg-accent/5 px-3 py-2"
                    >
                      <span className="text-sm font-medium text-ink">{topic}</span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => handleAddTopic(topic)} disabled={submitting}>
                        Add
                      </Button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </Card>

          <Card as="div">
            <CardHeader
              title="Active Database Topics"
              subtitle="When an author clicks “Start Generating”, the system randomly selects one of these as the primary keyword."
            />
            <div className="px-5 pb-5 pt-2">
              <form onSubmit={(e) => handleAddTopic(newTopic, e)} className="mb-4 flex gap-2">
                <Input
                  type="text"
                  containerClassName="flex-1"
                  placeholder="e.g., Diwali Puja Astrology…"
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  disabled={submitting}
                />
                <Button type="submit" variant="primary" disabled={!newTopic.trim() || submitting} loading={submitting}>
                  {submitting ? 'Adding…' : 'Add'}
                </Button>
              </form>

              <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                {loading ? (
                  <Skeleton rows={4} />
                ) : topics.length === 0 ? (
                  <EmptyState title="No topics yet" message="Add one above, or generate suggestions on the left." />
                ) : (
                  <AnimatePresence initial={false}>
                    {topics.map((t) => (
                      <motion.div
                        key={t.id}
                        layout
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex items-center justify-between rounded-lg border border-hairline bg-panel-raised/50 px-3 py-2 transition-colors hover:border-hairline-strong"
                      >
                        <span className="text-sm text-ink">{t.topic}</span>
                        <Button type="button" variant="ghost" size="sm" onClick={() => handleDelete(t.id)}>
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
      </section>

      <section aria-labelledby="content-config-heading" className="space-y-4">
        <div>
          <h2 id="content-config-heading" className="text-lg font-semibold text-ink">
            Content Configuration
          </h2>
          <p className="text-sm text-ink-muted">
            Global defaults every generation — manual or Autopilot — draws on automatically.
          </p>
        </div>

        <ImageDefaultsSettings />
        <FactVerificationSettings />
      </section>

      <IntegrationsSettings />

      <AgentChatWidget agents={['research_agent', 'autopilot_agent']} defaultAgent="research_agent" />
    </motion.div>
  );
}
