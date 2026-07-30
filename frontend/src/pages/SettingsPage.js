import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { settingsApi } from '../lib/api';

/**
 * SettingsPage (Trending Topics)
 *
 * Allows SEO executives and admins to manage the dynamic topics used
 * by the Automated AI Blog generation tool. Includes AI-powered real-time
 * trend suggestions.
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
      className="page-container"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <header className="page-header">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500 mb-2">
            Trending Topics
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

      <div className="grid lg:grid-cols-2 gap-8">
        <div className="card">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h2 className="text-xl font-semibold text-white">Auto Suggest (AI)</h2>
              <p className="text-sm text-gray-400 mt-1">
                Real-time analysis to suggest trending astrology topics based on current astrological events and search volume.
              </p>
            </div>
            <button
              type="button"
              onClick={handleSuggestTopics}
              disabled={suggesting}
              className="btn bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white whitespace-nowrap"
            >
              {suggesting ? 'Analyzing...' : 'Suggest Topics'}
            </button>
          </div>

          <div className="space-y-3">
            {suggesting && <div className="text-center py-8 text-gray-400">Asking AI to analyze trends...</div>}
            {!suggesting && suggestedTopics.length === 0 && (
              <div className="text-center py-8 text-gray-500 bg-white/5 rounded-xl border border-white/5">
                Click suggest to see real-time trends.
              </div>
            )}
            <AnimatePresence>
              {!suggesting && suggestedTopics.map((topic, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ delay: i * 0.1 }}
                  className="flex items-center justify-between p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl"
                >
                  <span className="text-white font-medium">{topic}</span>
                  <button
                    type="button"
                    onClick={() => handleAddTopic(topic)}
                    disabled={submitting}
                    className="text-purple-400 hover:text-purple-300 hover:bg-purple-400/10 p-2 rounded-lg transition-colors text-sm font-semibold"
                  >
                    Add
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        <div className="card">
          <h2 className="text-xl font-semibold mb-4 text-white">Active Database Topics</h2>
          <p className="text-sm text-gray-400 mb-6">
            When an author clicks "Start Generating", the system randomly selects one of these as the primary keyword.
          </p>

          <form onSubmit={(e) => handleAddTopic(newTopic, e)} className="flex gap-3 mb-8">
            <input
              type="text"
              className="input flex-1"
              placeholder="e.g., Diwali Puja Astrology..."
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

          <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
            {loading ? (
              <div className="text-center py-8 text-gray-400">Loading topics...</div>
            ) : topics.length === 0 ? (
              <div className="text-center py-8 text-gray-400 bg-white/5 rounded-xl border border-white/10">
                No topics found. Add some!
              </div>
            ) : (
              <AnimatePresence>
                {topics.map((t) => (
                  <motion.div
                    key={t.id}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors"
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
      </div>
    </motion.div>
  );
}
