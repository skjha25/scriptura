import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { keywordsApi, clustersApi } from '../lib/api';
import Button from '../components/ui/Button';
import { Input } from '../components/ui/form';
import AgentChatWidget from '../components/agents/AgentChatWidget';

export default function KeywordsPage() {
  const navigate = useNavigate();
  const [keywords, setKeywords] = useState([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [suggestedKeywords, setSuggestedKeywords] = useState([]);
  const [suggesting, setSuggesting] = useState(false);
  const [topicForSuggestion, setTopicForSuggestion] = useState('');

  useEffect(() => {
    fetchKeywords();
  }, []);

  const fetchKeywords = async () => {
    try {
      setLoading(true);
      const res = await keywordsApi.list({ limit: 100 });
      setKeywords(res.data || []);
    } catch (err) {
      setError(err.message || 'Failed to load keywords.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddKeyword = async (keywordText, e) => {
    if (e) e.preventDefault();
    if (!keywordText.trim()) return;

    try {
      setSubmitting(true);
      setError('');
      const added = await keywordsApi.create({ primary_keyword: keywordText.trim() });
      setKeywords([added, ...keywords]);
      if (keywordText === newKeyword) {
        setNewKeyword('');
      }
      
      setSuggestedKeywords(suggestedKeywords.filter(k => k !== keywordText.trim()));
    } catch (err) {
      setError(err.message || 'Failed to add keyword.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      setError('');
      await keywordsApi.remove(id);
      setKeywords(keywords.filter((k) => k.id !== id));
    } catch (err) {
      setError(err.message || 'Failed to delete keyword.');
    }
  };

  const handleSuggestKeywords = async (e) => {
    e.preventDefault();
    if (!topicForSuggestion.trim()) return;

    try {
      setSuggesting(true);
      setError('');
      const data = await keywordsApi.suggest(topicForSuggestion);
      setSuggestedKeywords(data || []);
    } catch (err) {
      setError(err.message || 'Failed to suggest keywords.');
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
            Keyword Pool
          </h1>
          <p className="text-gray-400">
            Manage your SEO keyword pool. Autopilot will pick from this list automatically.
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
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-white">Keyword Suggestions</h2>
            <p className="text-sm text-gray-400 mt-1">
              Ask AI for keyword ideas by entering a broad topic.
            </p>
          </div>

          <form onSubmit={handleSuggestKeywords} className="flex gap-3 mb-6">
            <Input
              type="text"
              containerClassName="flex-1"
              placeholder="e.g., Vedic Astrology..."
              value={topicForSuggestion}
              onChange={(e) => setTopicForSuggestion(e.target.value)}
              disabled={suggesting}
            />
            <Button
              type="submit"
              variant="primary"
              disabled={suggesting || !topicForSuggestion.trim()}
              loading={suggesting}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 border-none whitespace-nowrap"
            >
              {suggesting ? 'Fetching...' : 'Suggest Keywords'}
            </Button>
          </form>

          <div className="space-y-3">
            {suggesting && <div className="text-center py-8 text-gray-400">Fetching suggestions...</div>}
            {!suggesting && suggestedKeywords.length === 0 && (
              <div className="text-center py-8 text-gray-500 bg-white/5 rounded-xl border border-white/5">
                Suggestions will appear here.
              </div>
            )}
            <AnimatePresence>
              {!suggesting && suggestedKeywords.map((kw, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ delay: i * 0.1 }}
                  className="flex items-center justify-between p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl"
                >
                  <span className="text-white font-medium">{kw}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleAddKeyword(kw)}
                    disabled={submitting}
                    className="text-purple-400 hover:text-purple-300 hover:bg-purple-400/10"
                  >
                    Add
                  </Button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        <div className="card">
          <h2 className="text-xl font-semibold mb-4 text-white">Active Keyword Pool</h2>
          <p className="text-sm text-gray-400 mb-6">
            Keywords waiting to be processed by Autopilot.
          </p>

          <form onSubmit={(e) => handleAddKeyword(newKeyword, e)} className="flex gap-3 mb-8">
            <Input
              type="text"
              containerClassName="flex-1"
              placeholder="e.g., best horoscopes 2026"
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              disabled={submitting}
            />
            <Button
              type="submit"
              variant="primary"
              className="whitespace-nowrap"
              disabled={!newKeyword.trim() || submitting}
              loading={submitting}
            >
              {submitting ? 'Adding...' : 'Add Keyword'}
            </Button>
          </form>

          <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
            {loading ? (
              <div className="text-center py-8 text-gray-400">Loading keywords...</div>
            ) : keywords.length === 0 ? (
              <div className="text-center py-8 text-gray-400 bg-white/5 rounded-xl border border-white/10">
                No keywords found. Add some!
              </div>
            ) : (
              <AnimatePresence>
                {keywords.map((k) => (
                  <motion.div
                    key={k.id}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors"
                  >
                    <div>
                      <span className="text-white font-medium">{k.primary_keyword}</span>
                      <span className={`ml-3 text-xs px-2 py-0.5 rounded-full ${k.status === 'not_used' ? 'bg-blue-500/20 text-blue-300' : k.status === 'in_progress' ? 'bg-yellow-500/20 text-yellow-300' : 'bg-green-500/20 text-green-300'}`}>
                        {k.status.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={async () => {
                          try {
                            const cluster = await clustersApi.create({
                              name: `${k.primary_keyword} cluster`,
                              head_keyword: k.primary_keyword,
                              keywords: (k.secondary_keywords || []).map((sk) => ({ keyword: sk })),
                            });
                            navigate(`/clusters/${cluster.id}`);
                          } catch (err) {
                            setError(err.message || 'Failed to create cluster');
                          }
                        }}
                        className="text-accent hover:text-accent-bright hover:bg-accent/10 whitespace-nowrap"
                      >
                        Expand to Cluster
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        onClick={() => handleDelete(k.id)}
                        className="text-red-400 hover:text-red-300 hover:bg-red-400/10"
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
      </div>

      <AgentChatWidget agents={['research_agent']} defaultAgent="research_agent" />
    </motion.div>
  );
}
