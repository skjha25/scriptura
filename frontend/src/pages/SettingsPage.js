import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { settingsApi } from '../lib/api';

/**
 * SettingsPage
 *
 * Allows SEO executives and admins to manage the dynamic topics used
 * by the Automated AI Blog generation tool.
 */
export default function SettingsPage() {
  const [topics, setTopics] = useState([]);
  const [newTopic, setNewTopic] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

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

  const handleAddTopic = async (e) => {
    e.preventDefault();
    if (!newTopic.trim()) return;

    try {
      setSubmitting(true);
      setError('');
      const added = await settingsApi.addTopic({ topic: newTopic.trim() });
      setTopics([added, ...topics]);
      setNewTopic('');
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

  return (
    <motion.div
      className="page-container"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <header className="page-header">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500 mb-2">
            System Settings
          </h1>
          <p className="text-gray-400">
            Manage the trending astrology topics for the Automated AI Blog engine.
          </p>
        </div>
      </header>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl mb-6">
          {error}
        </div>
      )}

      <div className="card max-w-3xl">
        <h2 className="text-xl font-semibold mb-4 text-white">Automated Blog Topics</h2>
        <p className="text-sm text-gray-400 mb-6">
          Add or remove topics. When an author clicks "Start Generating" in the Automated AI Blog page,
          the system will randomly select one of these topics as the primary keyword and 4 others as secondary keywords.
        </p>

        <form onSubmit={handleAddTopic} className="flex gap-3 mb-8">
          <input
            type="text"
            className="input flex-1"
            placeholder="e.g., Diwali Puja Astrology, Career Horoscope 2027..."
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
            disabled={submitting}
          />
          <button
            type="submit"
            className="btn btn-primary whitespace-nowrap"
            disabled={!newTopic.trim() || submitting}
          >
            {submitting ? 'Adding...' : 'Add Topic'}
          </button>
        </form>

        <div className="space-y-3">
          {loading ? (
            <div className="text-center py-8 text-gray-400">Loading topics...</div>
          ) : topics.length === 0 ? (
            <div className="text-center py-8 text-gray-400 bg-white/5 rounded-xl border border-white/10">
              No topics found. Add some above!
            </div>
          ) : (
            <AnimatePresence>
              {topics.map((t) => (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors"
                >
                  <span className="text-white font-medium">{t.topic}</span>
                  <button
                    type="button"
                    onClick={() => handleDelete(t.id)}
                    className="text-red-400 hover:text-red-300 hover:bg-red-400/10 p-2 rounded-lg transition-colors text-sm font-medium"
                  >
                    Remove
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>
    </motion.div>
  );
}
