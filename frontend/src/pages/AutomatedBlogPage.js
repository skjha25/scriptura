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

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Rocket,
  Search,
  PenLine,
  FileText,
  Zap,
  CheckCircle2,
  XCircle,
  Lightbulb,
  Pencil,
  RotateCcw,
  Check,
} from 'lucide-react';

import { blogsApi, generateApi } from '../lib/api';
import { buildGenerationConfig } from '../components/wizard/Step6Generate';
import { INITIAL_CONFIG } from '../components/wizard/steps';
import { DEFAULT_IMAGE_STYLE, DEFAULT_SEO_STRUCTURE } from '../lib/constants';
import { Card } from '../components/ui/feedback';
import Button from '../components/ui/Button';
import AgentChatWidget from '../components/agents/AgentChatWidget';

// ─── Stage definitions ──────────────────────────────────────────────────────
const STAGES = [
  { key: 'idle', label: 'Ready', icon: Rocket, description: 'Click below to start fully automated blog generation.' },
  { key: 'topic', label: 'Finding Topic', icon: Search, description: 'AI is researching trending astrology topics…' },
  { key: 'title', label: 'Generating Title', icon: PenLine, description: 'Scoring and selecting the best SEO title…' },
  { key: 'creating', label: 'Creating Draft', icon: FileText, description: 'Setting up the blog with optimized defaults…' },
  { key: 'generating', label: 'Writing Article', icon: Zap, description: 'AI is writing your full article with images and SEO…' },
  { key: 'done', label: 'Complete!', icon: CheckCircle2, description: 'Your article is ready for review.' },
  { key: 'error', label: 'Something went wrong', icon: XCircle, description: '' },
];

function stageIndex(key) {
  return STAGES.findIndex((s) => s.key === key);
}

// ─── Ambient background ─────────────────────────────────────────────────────
/**
 * A small, fixed set of soft accent-colored motes — deliberately not a dense
 * randomized particle field (the spec calls that out as a template cliché).
 * Positions/delays are computed once via `memo` so they don't reshuffle on
 * every re-render — this component re-mounts under a parent that updates
 * every second while generation is running, and without memoizing it the
 * dots used to visibly jump to new random positions each tick.
 */
const FloatingParticles = memo(function FloatingParticles() {
  const dots = [
    { top: '15%', left: '10%', size: 3, delay: 0 },
    { top: '25%', left: '85%', size: 4, delay: 0.6 },
    { top: '65%', left: '92%', size: 3, delay: 1.2 },
    { top: '80%', left: '8%', size: 4, delay: 1.8 },
    { top: '45%', left: '50%', size: 3, delay: 2.4 },
    { top: '10%', left: '55%', size: 2, delay: 0.3 },
    { top: '70%', left: '35%', size: 3, delay: 1.5 },
  ];

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
      {dots.map((dot, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full bg-accent/25"
          style={{ top: dot.top, left: dot.left, width: dot.size, height: dot.size }}
          animate={{ y: [0, -24, 0], opacity: [0.2, 0.55, 0.2] }}
          transition={{ duration: 6, repeat: Infinity, delay: dot.delay, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
});

// ─── Promo Workflow (Idle State) ────────────────────────────────────────────
function PromoWorkflow() {
  const steps = [
    { id: 'Idea', icon: Lightbulb, desc: 'Brainstorm concepts' },
    { id: 'Draft', icon: FileText, desc: 'Write full article' },
    { id: 'Review', icon: CheckCircle2, desc: 'Check SEO & facts' },
    { id: 'Publish', icon: Rocket, desc: 'Go live anytime' },
  ];

  return (
    <div className="relative z-10 mx-auto my-8 w-full max-w-4xl">
      <div className="mb-10 text-center">
        <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">
          Your content creates itself.{' '}
          <span className="bg-glow-accent bg-clip-text text-transparent">You stay in control.</span>
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-ink-muted md:text-lg">
          Define your niche and standards just once. From there, our AI engine dreams up fresh topics, drafts full
          articles, verifies facts, and optimizes for search. You just drop in whenever you're ready to review and
          publish.
        </p>
      </div>

      <div className="relative grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
        {/* Connection line */}
        <div
          aria-hidden="true"
          className="absolute left-[12%] right-[12%] top-[40%] z-0 hidden h-px -translate-y-1/2 bg-gradient-to-r from-accent/20 via-accent/50 to-accent-magenta/20 md:block"
        />

        {steps.map((step, i) => {
          const Icon = step.icon;
          return (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.1 }}
              className="relative z-10"
            >
              <Card className="flex flex-col items-center p-5 text-center">
                <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-glow-subtle text-accent-bright">
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <h3 className="text-base font-semibold text-ink">{step.id}</h3>
                <p className="mt-1 text-xs text-ink-muted md:text-sm">{step.desc}</p>
              </Card>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Animated stage card ────────────────────────────────────────────────────
function StageCard({ stage, elapsed, details, error }) {
  const def = STAGES.find((s) => s.key === stage) || STAGES[0];
  const idx = stageIndex(stage);
  const total = STAGES.length - 2; // exclude idle and error
  const Icon = def.icon;

  return (
    <motion.div
      layout
      className="relative mx-auto w-full max-w-lg overflow-hidden rounded-2xl border border-hairline bg-panel/60 shadow-panel backdrop-blur-xl"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 150, damping: 20 }}
    >
      {/* Progress bar */}
      {stage !== 'idle' && stage !== 'error' && (
        <motion.div
          className="absolute left-0 top-0 h-1 bg-glow-accent"
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
          className="mb-4 inline-grid h-16 w-16 place-items-center rounded-2xl bg-glow-subtle text-accent-bright"
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        >
          <Icon className="h-7 w-7" strokeWidth={1.75} />
        </motion.div>

        {/* Stage label */}
        <AnimatePresence mode="wait">
          <motion.h2
            key={`label-${stage}`}
            className="mb-2 font-display text-xl font-semibold text-ink"
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
            className="mb-4 text-sm text-ink-muted"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {stage === 'error' ? error : def.description}
          </motion.p>
        </AnimatePresence>

        {/* Spinner for active stages */}
        {!['idle', 'done', 'error'].includes(stage) && (
          <div className="mb-4 flex items-center justify-center gap-3">
            <div className="relative h-8 w-8">
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-l-transparent border-b-accent-magenta border-r-accent-violet border-t-accent"
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              />
            </div>
            {elapsed > 0 && (
              <span className="font-mono text-xs tabular-nums text-ink-muted">{formatElapsed(elapsed)}</span>
            )}
          </div>
        )}

        {/* Details */}
        {details && (
          <AnimatePresence mode="wait">
            <motion.div
              key={`details-${stage}`}
              className="mt-4 rounded-xl border border-hairline bg-panel-sunken p-4 text-left text-sm text-ink-secondary"
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
    <div className="mb-8 flex flex-wrap items-center justify-center gap-2">
      {activeSteps.map((s, i) => {
        const sIdx = stageIndex(s.key);
        const isActive = sIdx === currentIdx;
        const isDone = sIdx < currentIdx;
        const Icon = s.icon;

        return (
          <div key={s.key} className="flex items-center gap-2">
            <motion.div
              className={
                isDone
                  ? 'flex items-center gap-1.5 rounded-full border border-status-good/30 bg-status-good/15 px-3 py-1.5 text-xs font-medium text-status-good'
                  : isActive
                    ? 'flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent-bright shadow-glow-sm'
                    : 'flex items-center gap-1.5 rounded-full border border-hairline bg-panel-raised/50 px-3 py-1.5 text-xs font-medium text-ink-muted'
              }
              animate={isActive ? { scale: [1, 1.05, 1] } : {}}
              transition={isActive ? { duration: 1.5, repeat: Infinity } : {}}
            >
              {isDone ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />}
              <span className="hidden sm:inline">{s.label}</span>
            </motion.div>
            {i < activeSteps.length - 1 && (
              <div className={`h-px w-4 ${isDone ? 'bg-status-good/40' : 'bg-hairline'}`} />
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
              <div className="flex justify-between">
                <span>SEO Score</span>
                <span className="font-semibold text-status-good">{status.seo_score ?? '—'}/100</span>
              </div>
              <div className="flex justify-between">
                <span>Word Count</span>
                <span className="font-semibold text-accent-bright">{status.word_count?.toLocaleString() ?? '—'}</span>
              </div>
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
          <div className="font-medium text-ink">&quot;{chosenTitle}&quot;</div>
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
        image_style: DEFAULT_IMAGE_STYLE,
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
          <div><span className="text-ink-muted">Status:</span> <span className="text-status-warning">Draft</span></div>
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
        <div className="text-center text-ink-muted">
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
    <div className="relative flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-4 py-12">
      <FloatingParticles />

      {/* Header */}
      <motion.div
        className="relative z-10 mb-8 text-center"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="mb-2 font-display text-3xl font-semibold sm:text-4xl">
          <span className="bg-glow-accent bg-clip-text text-transparent">Autopilot Mode</span>
        </h1>
        <p className="mx-auto max-w-md text-sm text-ink-muted sm:text-base">
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
        <div className="relative z-10 mt-8 w-full max-w-lg">
          <StageCard stage={stage} elapsed={elapsed} details={details} error={error} />
        </div>
      )}

      {/* Action buttons */}
      <motion.div
        className="relative z-10 mt-8 flex flex-col gap-3 sm:flex-row"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        {stage === 'idle' && (
          <button
            type="button"
            onClick={startAutomation}
            className="group relative inline-flex items-center gap-2 overflow-hidden rounded-xl bg-glow-accent px-8 py-3.5 text-base font-semibold text-white shadow-glow-sm transition-all duration-200 hover:shadow-glow active:scale-[0.97]"
          >
            {/* Shimmer effect */}
            <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            <Rocket className="relative z-10 h-5 w-5" strokeWidth={2} />
            <span className="relative z-10">Start Generating</span>
          </button>
        )}

        {stage === 'done' && (
          <>
            <Button variant="success" size="lg" onClick={() => navigate(`/blogs/${blogId}/edit`)}>
              <Pencil className="h-4 w-4" strokeWidth={2} />
              Review &amp; Edit Article
            </Button>
            <Button variant="secondary" size="lg" onClick={handleRetry}>
              <RotateCcw className="h-4 w-4" strokeWidth={2} />
              Generate Another
            </Button>
          </>
        )}

        {stage === 'error' && (
          <Button variant="danger" size="lg" onClick={handleRetry}>
            <RotateCcw className="h-4 w-4" strokeWidth={2} />
            Try Again
          </Button>
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
          <button type="button" onClick={() => navigate(`/blogs/${blogId}`)} className="text-accent hover:underline">
            View
          </button>
        </motion.p>
      )}

      {/* Same two agents as the Wizard — this page shares the same generation pipeline. */}
      <AgentChatWidget agents={['generate_agent', 'blog_image_agent']} defaultAgent="generate_agent" />
    </div>
  );
}
