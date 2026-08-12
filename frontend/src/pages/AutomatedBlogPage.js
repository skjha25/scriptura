// frontend/src/pages/AutomatedBlogPage.js
/**
 * Automated AI Blog — one-click fully autonomous blog generation.
 *
 * The user clicks "Start Generating" and the system:
 *   1. Asks AI for a trending astrology topic + keywords + title suggestions
 *   2. Picks the highest-scoring title
 *   3. Creates a blog draft with all sensible defaults
 *   4. Triggers the full article generation pipeline
 *   5. Polls until done and navigates to the editor
 *
 * No manual input required. Every wizard step is handled automatically.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

import { blogsApi, generateApi } from '../lib/api';
import { buildGenerationConfig } from '../components/wizard/Step6Generate';
import { INITIAL_CONFIG } from '../components/wizard/steps';
import { DEFAULT_SEO_STRUCTURE } from '../lib/constants';
import AgentChatWidget from '../components/agents/AgentChatWidget';

// ─── Stage definitions ──────────────────────────────────────────────────────
const STAGES = [
  { key: 'idle',       label: 'Ready',                icon: '🚀', description: 'Click below to start fully automated blog generation.' },
  { key: 'topic',      label: 'Finding Topic',        icon: '🔍', description: 'AI is researching trending astrology topics…' },
  { key: 'title',      label: 'Generating Title',     icon: '✍️', description: 'Scoring and selecting the best SEO title…' },
  { key: 'creating',   label: 'Creating Draft',       icon: '📝', description: 'Setting up the blog with optimized defaults…' },
  { key: 'generating', label: 'Writing Article',      icon: '⚡', description: 'AI is writing your full article with images and SEO…' },
  { key: 'done',       label: 'Complete!',            icon: '✅', description: 'Your article is ready for review.' },
  { key: 'error',      label: 'Something went wrong', icon: '❌', description: '' },
];

function stageIndex(key) {
  return STAGES.findIndex((s) => s.key === key);
}

// ─── Particle background ────────────────────────────────────────────────────
function FloatingParticles() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
      {Array.from({ length: 20 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: Math.random() * 4 + 2,
            height: Math.random() * 4 + 2,
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            background: `hsla(${220 + Math.random() * 40}, 80%, 70%, ${0.15 + Math.random() * 0.2})`,
          }}
          animate={{
            y: [0, -30 - Math.random() * 40, 0],
            x: [0, (Math.random() - 0.5) * 20, 0],
            opacity: [0.2, 0.6, 0.2],
          }}
          transition={{
            duration: 4 + Math.random() * 4,
            repeat: Infinity,
            delay: Math.random() * 3,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}

// ─── Promo Workflow (Idle State) ────────────────────────────────────────────
function PromoWorkflow() {
  const steps = [
    { id: 'Idea', icon: '💡', desc: 'Brainstorm concepts' },
    { id: 'Draft', icon: '📝', desc: 'Write full article' },
    { id: 'Review', icon: '✅', desc: 'Check SEO & facts' },
    { id: 'Publish', icon: '🚀', desc: 'Go live anytime' },
  ];

  return (
    <div className="w-full max-w-4xl mx-auto my-8 relative z-10">
      <div className="text-center mb-10">
        <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">
          Your content creates itself. <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">You stay in control.</span>
        </h2>
        <p className="text-gray-400 max-w-2xl mx-auto text-base md:text-lg leading-relaxed">
          Define your niche and standards just once. From there, our AI engine dreams up fresh topics, drafts full articles, verifies facts, and optimizes for search. You just drop in whenever you're ready to review and publish.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 relative">
        {/* Connection line */}
        <div className="hidden md:block absolute top-[40%] left-[12%] right-[12%] h-[2px] bg-gradient-to-r from-blue-500/20 via-purple-500/50 to-pink-500/20 -translate-y-1/2 z-0" />
        
        {steps.map((step, i) => (
          <motion.div
            key={step.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.1 }}
            className="relative z-10 flex flex-col items-center p-5 bg-panel/40 backdrop-blur-md border border-white/10 rounded-2xl shadow-xl hover:bg-panel/80 hover:border-white/20 transition-all"
          >
            <div className="text-3xl mb-3 p-4 bg-white/5 rounded-full shadow-inner border border-white/5">
              {step.icon}
            </div>
            <h3 className="text-white font-bold text-lg mb-1">{step.id}</h3>
            <p className="text-gray-400 text-xs md:text-sm text-center">{step.desc}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ─── Animated stage card ────────────────────────────────────────────────────
function StageCard({ stage, elapsed, details, error }) {
  const def = STAGES.find((s) => s.key === stage) || STAGES[0];
  const idx = stageIndex(stage);
  const total = STAGES.length - 2; // exclude idle and error

  return (
    <motion.div
      layout
      className="relative w-full max-w-lg mx-auto overflow-hidden rounded-2xl border border-white/10 bg-panel/60 backdrop-blur-xl shadow-2xl"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 150, damping: 20 }}
    >
      {/* Progress bar */}
      {stage !== 'idle' && stage !== 'error' && (
        <motion.div
          className="absolute top-0 left-0 h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500"
          initial={{ width: '0%' }}
          animate={{
            width: stage === 'done' ? '100%' : `${(Math.max(0, idx - 1) / (total - 1)) * 100}%`,
          }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      )}

      <div className="p-8 text-center">
        {/* Stage icon */}
        <motion.div
          key={stage}
          className="text-5xl mb-4 inline-block"
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        >
          {def.icon}
        </motion.div>

        {/* Stage label */}
        <AnimatePresence mode="wait">
          <motion.h2
            key={`label-${stage}`}
            className="text-xl font-bold text-ink mb-2"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {def.label}
          </motion.h2>
        </AnimatePresence>

        {/* Description */}
        <AnimatePresence mode="wait">
          <motion.p
            key={`desc-${stage}`}
            className="text-sm text-ink-muted mb-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {stage === 'error' ? error : def.description}
          </motion.p>
        </AnimatePresence>

        {/* Spinner for active stages */}
        {!['idle', 'done', 'error'].includes(stage) && (
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="relative w-8 h-8">
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-t-blue-500 border-r-purple-500 border-b-pink-500 border-l-transparent"
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              />
            </div>
            {elapsed > 0 && (
              <span className="text-xs text-ink-muted font-mono tabular-nums">
                {formatElapsed(elapsed)}
              </span>
            )}
          </div>
        )}

        {/* Details */}
        {details && (
          <AnimatePresence mode="wait">
            <motion.div
              key={`details-${stage}`}
              className="mt-4 rounded-xl bg-surface/50 border border-white/5 p-4 text-left text-sm text-ink-secondary"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              {details}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </motion.div>
  );
}

// ─── Step progress timeline ─────────────────────────────────────────────────
function StepTimeline({ stage }) {
  const activeSteps = STAGES.filter((s) => !['idle', 'error'].includes(s.key));
  const currentIdx = stageIndex(stage);

  return (
    <div className="flex items-center justify-center gap-2 mb-8 flex-wrap">
      {activeSteps.map((s, i) => {
        const sIdx = stageIndex(s.key);
        const isActive = sIdx === currentIdx;
        const isDone = sIdx < currentIdx;

        return (
          <div key={s.key} className="flex items-center gap-2">
            <motion.div
              className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all
                ${isDone
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : isActive
                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40 shadow-lg shadow-blue-500/10'
                    : 'bg-surface/30 text-ink-muted border border-white/5'}
              `}
              animate={isActive ? { scale: [1, 1.05, 1] } : {}}
              transition={isActive ? { duration: 1.5, repeat: Infinity } : {}}
            >
              <span>{isDone ? '✓' : s.icon}</span>
              <span className="hidden sm:inline">{s.label}</span>
            </motion.div>
            {i < activeSteps.length - 1 && (
              <div className={`w-4 h-px ${isDone ? 'bg-green-500/40' : 'bg-white/10'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function formatElapsed(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

// ─── Main page component ───────────────────────────────────────────────────
export default function AutomatedBlogPage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [details, setDetails] = useState(null);
  const [blogId, setBlogId] = useState(null);

  const timerRef = useRef(null);
  const startTimeRef = useRef(null);
  const abortRef = useRef(false);

  // Elapsed time tracker
  useEffect(() => {
    if (!['idle', 'done', 'error'].includes(stage)) {
      if (!startTimeRef.current) startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Date.now() - startTimeRef.current);
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [stage]);

  // Poll generation status
  const pollGeneration = useCallback(async (id) => {
    const POLL_INTERVAL = 2500;
    const MAX_POLLS = 180; // ~7.5 minutes max
    let polls = 0;

    while (polls < MAX_POLLS) {
      if (abortRef.current) return;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
      polls++;

      try {
        const status = await blogsApi.generationStatus(id);

        if (status.generation_status === 'generated') {
          setDetails(
            <div className="space-y-2">
              <div className="flex justify-between"><span>SEO Score</span><span className="font-bold text-green-400">{status.seo_score ?? '—'}/100</span></div>
              <div className="flex justify-between"><span>Word Count</span><span className="font-bold text-blue-400">{status.word_count?.toLocaleString() ?? '—'}</span></div>
            </div>
          );
          setStage('done');
          return;
        }

        if (status.generation_status === 'failed') {
          throw new Error(status.generation_error || 'Generation failed. Please retry.');
        }
      } catch (err) {
        setError(err.message || 'Generation polling failed.');
        setStage('error');
        return;
      }
    }

    setError('Generation timed out. Check the blog list for the article status.');
    setStage('error');
  }, []);

  // The main orchestrator
  const startAutomation = useCallback(async () => {
    abortRef.current = false;
    startTimeRef.current = Date.now();
    setElapsed(0);
    setError('');
    setDetails(null);
    setBlogId(null);

    try {
      // ── Step 1: Auto-generate topic ────────────────────────────────────
      setStage('topic');
      const topicResult = await generateApi.autoTopic();

      if (abortRef.current) return;
      setDetails(
        <div className="space-y-1">
          <div><span className="text-ink-muted">Topic:</span> <span className="font-medium text-ink">{topicResult.topic}</span></div>
          <div><span className="text-ink-muted">Keyword:</span> <span className="font-medium text-ink">{topicResult.seo_keywords}</span></div>
          <div><span className="text-ink-muted">Secondary:</span> <span className="font-medium text-ink">{(topicResult.secondary_keywords || []).join(', ')}</span></div>
        </div>
      );

      // ── Step 2: Pick best title ────────────────────────────────────────
      await new Promise((r) => setTimeout(r, 800));
      if (abortRef.current) return;
      setStage('title');

      const titles = topicResult.titles || [];
      // Pick highest-scoring title
      const bestTitle = titles.reduce((best, current) => {
        if (!best) return current;
        return (current.seo?.score ?? 0) > (best.seo?.score ?? 0) ? current : best;
      }, null);

      const chosenTitle = bestTitle?.title || `${topicResult.topic}: What the Stars Reveal`;
      setDetails(
        <div className="space-y-2">
          <div className="text-ink font-medium">"{chosenTitle}"</div>
          {bestTitle?.seo && (
            <div className="text-xs text-ink-muted">SEO Score: {bestTitle.seo.score}/100</div>
          )}
        </div>
      );

      // ── Step 3: Create blog draft ──────────────────────────────────────
      await new Promise((r) => setTimeout(r, 800));
      if (abortRef.current) return;
      setStage('creating');

      const blogPayload = {
        blog_title: chosenTitle,
        topic: topicResult.topic,
        seo_keywords: topicResult.seo_keywords,
        secondary_keywords: topicResult.secondary_keywords || [],
        // Brand voice: none (no brand voice for automated)
        brand_voice_source_type: 'none',
        brand_voice_confirmed: false,
        // Content defaults
        article_type: 'general',
        tone_of_voice: 'informative',
        point_of_view: 'second_person',
        target_country: 'IN',
        language: 'en',
        readability_level: '8th_grade',
        ai_content_cleaning: false,
        seo_structure_config: { ...DEFAULT_SEO_STRUCTURE },
        internal_linking: true,
        internal_link_targets: [],
        external_web_grounding: false,
        // Images
        include_images: true,
        image_count: 1,
        image_style: 'photo',
        logo_overlay: true,
        logo_position: 'top_right',
        // Publishing
        published_by: 'DivineTalk Astrology',
        category: 'Astrology',
        tags: topicResult.secondary_keywords?.slice(0, 3) || [],
      };

      const blog = await blogsApi.create(blogPayload);
      const newBlogId = blog.id;
      setBlogId(newBlogId);

      setDetails(
        <div className="space-y-1">
          <div><span className="text-ink-muted">Blog ID:</span> <span className="font-medium text-ink">#{newBlogId}</span></div>
          <div><span className="text-ink-muted">Title:</span> <span className="font-medium text-ink">{chosenTitle}</span></div>
          <div><span className="text-ink-muted">Status:</span> <span className="text-yellow-400">Draft</span></div>
        </div>
      );

      // ── Step 4: Trigger article generation ─────────────────────────────
      await new Promise((r) => setTimeout(r, 600));
      if (abortRef.current) return;
      setStage('generating');

      // Build the generation config matching what the wizard would send
      const autoConfig = {
        ...INITIAL_CONFIG,
        ...blogPayload,
        blog_title: chosenTitle,
      };
      const genConfig = buildGenerationConfig(autoConfig);

      await generateApi.article({ blog_id: newBlogId, config: genConfig });
      setDetails(
        <div className="text-ink-muted text-center">
          AI is writing your full article. This typically takes 30–90 seconds.
        </div>
      );

      // ── Step 5: Poll until done ────────────────────────────────────────
      await pollGeneration(newBlogId);

    } catch (err) {
      const msg = err?.response?.data?.error?.message || err.message || 'An unexpected error occurred.';
      setError(msg);
      setStage('error');
    }
  }, [pollGeneration]);

  const handleRetry = () => {
    setStage('idle');
    setError('');
    setDetails(null);
    setElapsed(0);
    startTimeRef.current = null;
    setBlogId(null);
  };

  return (
    <div className="relative min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center px-4 py-12">
      <FloatingParticles />

      {/* Header */}
      <motion.div
        className="text-center mb-8 relative z-10"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-3xl sm:text-4xl font-extrabold text-ink mb-2">
          <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            Autopilot Mode
          </span>
        </h1>
        <p className="text-ink-muted text-sm sm:text-base max-w-md mx-auto">
          One click. AI picks the topic, writes the article, generates images, and scores for SEO — all automatically.
        </p>
      </motion.div>

      {/* Step timeline */}
      {stage !== 'idle' && stage !== 'error' && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 w-full max-w-2xl"
        >
          <StepTimeline stage={stage} />
        </motion.div>
      )}

      {/* Main content or Promo */}
      {stage === 'idle' ? (
        <PromoWorkflow />
      ) : (
        <div className="relative z-10 w-full max-w-lg mt-8">
          <StageCard stage={stage} elapsed={elapsed} details={details} error={error} />
        </div>
      )}

      {/* Action buttons */}
      <motion.div
        className="relative z-10 mt-8 flex flex-col sm:flex-row gap-3"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        {stage === 'idle' && (
          <button
            onClick={startAutomation}
            className="
              group relative inline-flex items-center gap-2 px-8 py-3.5 rounded-xl
              bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600
              text-white font-semibold text-base shadow-xl
              hover:shadow-2xl hover:shadow-purple-500/25
              active:scale-[0.97] transition-all duration-200
              overflow-hidden
            "
          >
            {/* Shimmer effect */}
            <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
            <svg className="w-5 h-5 relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="relative z-10">Start Generating</span>
          </button>
        )}

        {stage === 'done' && (
          <>
            <button
              onClick={() => navigate(`/blogs/${blogId}/edit`)}
              className="
                inline-flex items-center gap-2 px-6 py-3 rounded-xl
                bg-gradient-to-r from-green-600 to-emerald-600
                text-white font-semibold shadow-lg
                hover:shadow-xl hover:shadow-green-500/25
                active:scale-[0.97] transition-all duration-200
              "
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
              Review & Edit Article
            </button>
            <button
              onClick={handleRetry}
              className="
                inline-flex items-center gap-2 px-6 py-3 rounded-xl
                border border-white/10 bg-surface/50 backdrop-blur
                text-ink-secondary font-medium
                hover:bg-surface hover:text-ink
                active:scale-[0.97] transition-all duration-200
              "
            >
              Generate Another
            </button>
          </>
        )}

        {stage === 'error' && (
          <button
            onClick={handleRetry}
            className="
              inline-flex items-center gap-2 px-6 py-3 rounded-xl
              border border-red-500/30 bg-red-500/10
              text-red-400 font-medium
              hover:bg-red-500/20
              active:scale-[0.97] transition-all duration-200
            "
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
            Try Again
          </button>
        )}
      </motion.div>

      {/* Recent generation info */}
      {stage === 'done' && blogId && (
        <motion.p
          className="relative z-10 mt-4 text-xs text-ink-muted"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          Blog #{blogId} created in {formatElapsed(elapsed)} •{' '}
          <button
            onClick={() => navigate(`/blogs/${blogId}`)}
            className="text-accent hover:underline"
          >
            View
          </button>
        </motion.p>
      )}

      {/* Same two agents as the Wizard — this page shares the same generation pipeline. */}
      <AgentChatWidget agents={['generate_agent', 'blog_image_agent']} defaultAgent="generate_agent" />
    </div>
  );
}
