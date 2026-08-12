// frontend/src/components/agents/AgentCommunicationVisualizer.js
/**
 * "Live Agent Activity" showcase panel for the top of AgentActivityPage.
 *
 * Purely a visual storytelling piece — an orchestrated, looping simulation of
 * message packets moving between agent nodes. It does not read real activity
 * rows (the timeline below already does that); it exists to make the
 * multi-agent system *feel* alive at a glance.
 *
 * Design: a single scripted STEPS sequence (a realistic Chief → Research →
 * SEO → Generate → Blog Ops → Image → Chief workflow) drives which agent is
 * in which visual mode at any moment, plus an independent "burst" timer that
 * occasionally fires 2-3 simultaneous packets over edges the main sequence
 * never uses — that's what keeps the network reading as organic rather than
 * a straight pipeline. A node's mode is derived fresh from the current step
 * every render (unmentioned agents default to idle), so there is no manual
 * state-reset bookkeeping to get wrong.
 *
 * Node identity (key/label/icon) is derived from AGENT_META, the same single
 * source of truth AgentActivityPage.js and AgentChatWidget.js use, so this
 * panel can't silently drift out of sync with the real agent roster.
 */

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';

import { AGENT_META } from '../../lib/agentMeta';
import { Card } from '../ui/feedback';

// Position (percent of the panel, 0-100 on both axes), short role tag, and a
// depth tier used purely for size/opacity so the network doesn't read flat.
// Chief is deliberately off-center-left and larger — the orchestrator, not
// just another node in a row.
const NODE_LAYOUT = [
  { key: 'chief_agent', role: 'Coordinator', x: 13, y: 50, tasksToday: 52, depth: 'chief' },
  { key: 'research_agent', role: 'Knowledge & Research', x: 37, y: 17, tasksToday: 31, depth: 'primary' },
  { key: 'seo_analyst_agent', role: 'SEO Analysis', x: 63, y: 12, tasksToday: 24, depth: 'secondary' },
  { key: 'generate_agent', role: 'Content Generation', x: 61, y: 54, tasksToday: 38, depth: 'primary' },
  { key: 'blog_ops_agent', role: 'Content Operations', x: 84, y: 80, tasksToday: 27, depth: 'secondary' },
  { key: 'blog_image_agent', role: 'Visual Generation', x: 97, y: 42, tasksToday: 19, depth: 'secondary' },
];

const NODES = NODE_LAYOUT.map((n) => ({ ...n, label: AGENT_META[n.key].label, icon: AGENT_META[n.key].icon }));
const NODE_MAP = Object.fromEntries(NODES.map((n) => [n.key, n]));

// Every connection the network ever draws, always faintly visible. Two of
// them (chief→seo, generate→research) are never used by the scripted
// workflow below — they only ever light up during a burst — which is what
// keeps this from reading as a single-file pipeline.
const CONNECTIONS = [
  { from: 'chief_agent', to: 'research_agent', bow: 9, tier: 'primary' },
  { from: 'chief_agent', to: 'seo_analyst_agent', bow: -22, tier: 'extra' },
  { from: 'research_agent', to: 'seo_analyst_agent', bow: 8, tier: 'primary' },
  { from: 'seo_analyst_agent', to: 'generate_agent', bow: 10, tier: 'primary' },
  { from: 'generate_agent', to: 'research_agent', bow: -13, tier: 'extra' },
  { from: 'generate_agent', to: 'blog_ops_agent', bow: 8, tier: 'primary' },
  { from: 'blog_ops_agent', to: 'blog_image_agent', bow: -9, tier: 'primary' },
  { from: 'blog_image_agent', to: 'blog_ops_agent', bow: 11, tier: 'primary' },
  { from: 'blog_ops_agent', to: 'chief_agent', bow: 20, tier: 'primary' },
];

// The realistic scripted workflow. `agents` only lists nodes that deviate
// from idle this step — everything else falls back to idle automatically,
// so a node's "sending" glow naturally lasts exactly one step and its
// "receiving" pulse fires mid-flight without any explicit reset elsewhere.
const STEPS = [
  { id: 'chief-think', agents: { chief_agent: { mode: 'thinking', label: 'Thinking…' } }, duration: 1300 },
  {
    id: 'chief-to-research',
    packet: { from: 'chief_agent', to: 'research_agent', message: 'Research topic' },
    agents: { chief_agent: { mode: 'sending' } },
    feed: 'Researching latest topic data',
    duration: 1300,
  },
  {
    id: 'research-tool',
    agents: { research_agent: { mode: 'tool_call', label: 'knowledge_search()' } },
    duration: 1000,
  },
  {
    id: 'research-result',
    agents: { research_agent: { mode: 'processing', label: '14 relevant sources found' } },
    duration: 900,
  },
  {
    id: 'research-to-seo',
    packet: { from: 'research_agent', to: 'seo_analyst_agent', message: 'Knowledge ready' },
    agents: { research_agent: { mode: 'sending' } },
    feed: 'Knowledge ready',
    duration: 1300,
  },
  {
    id: 'seo-metrics',
    agents: {
      seo_analyst_agent: {
        mode: 'processing',
        metrics: ['Intent: Informational', 'Competition: Medium', 'Keywords: 18'],
      },
    },
    duration: 1500,
  },
  {
    id: 'seo-to-generate',
    packet: { from: 'seo_analyst_agent', to: 'generate_agent', message: 'SEO brief ready' },
    agents: { seo_analyst_agent: { mode: 'sending' } },
    feed: 'SEO brief generated',
    duration: 1300,
  },
  {
    id: 'generate-progress',
    agents: { generate_agent: { mode: 'processing', label: 'Generating content…', progressSeq: [32, 61, 87, 100] } },
    duration: 2000,
  },
  {
    id: 'generate-to-blogops',
    packet: { from: 'generate_agent', to: 'blog_ops_agent', message: 'Draft ready' },
    agents: { generate_agent: { mode: 'sending' } },
    feed: 'Draft ready for review',
    duration: 1300,
  },
  {
    id: 'blogops-review',
    agents: { blog_ops_agent: { mode: 'thinking', label: 'Reviewing content…' } },
    duration: 1000,
  },
  {
    id: 'blogops-to-image',
    packet: { from: 'blog_ops_agent', to: 'blog_image_agent', message: 'Hero image required' },
    agents: { blog_ops_agent: { mode: 'sending' } },
    feed: 'Requesting hero image',
    duration: 1300,
  },
  {
    id: 'image-generating',
    agents: { blog_image_agent: { mode: 'processing', label: 'Generating visual…' } },
    duration: 1500,
  },
  {
    id: 'image-to-blogops',
    packet: { from: 'blog_image_agent', to: 'blog_ops_agent', message: 'Image generated ✓' },
    agents: { blog_image_agent: { mode: 'complete' } },
    feed: 'Hero image ready',
    duration: 1300,
  },
  {
    id: 'blogops-to-chief',
    packet: { from: 'blog_ops_agent', to: 'chief_agent', message: 'Workflow complete' },
    agents: { blog_ops_agent: { mode: 'sending' } },
    feed: 'Workflow complete',
    duration: 1300,
  },
  { id: 'chief-complete', agents: { chief_agent: { mode: 'complete', label: 'Workflow complete' } }, duration: 1300 },
  { id: 'settle', agents: {}, duration: 1200 },
];

// Burst-only edges: a rare, elegant flourish, never touched by the scripted
// workflow, so it reads as "something extra just happened" rather than a
// repeat of the main loop.
const BURST_EDGES = [
  { from: 'chief_agent', to: 'research_agent', message: 'Status sync' },
  { from: 'chief_agent', to: 'seo_analyst_agent', message: 'Priority check' },
  { from: 'generate_agent', to: 'research_agent', message: 'Cross-check' },
];

const TRAVEL_S = 1.15;

const MODE_LABEL = {
  idle: 'Idle',
  thinking: 'Thinking',
  processing: 'Processing',
  tool_call: 'Calling tool',
  sending: 'Sending',
  receiving: 'Receiving',
  complete: 'Complete',
};

const MODE_RING = {
  idle: 'border-white/10',
  thinking: 'border-accent/35',
  processing: 'border-accent/45',
  tool_call: 'border-accent-violet/50',
  sending: 'border-accent-bright/70',
  receiving: 'border-accent-bright/60',
  complete: 'border-status-good/60',
};

function edgePath(from, to, bow) {
  const a = NODE_MAP[from];
  const b = NODE_MAP[to];
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const cx = mx + (-dy / len) * bow;
  const cy = my + (dx / len) * bow;
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (e) => setReduced(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Steps a node's progress bar through a milestone sequence over the step's own duration. */
function useProgressSeq(seq, active, durationMs) {
  const [value, setValue] = useState(seq ? seq[0] : 0);
  useEffect(() => {
    if (!seq || !active) return undefined;
    setValue(seq[0]);
    const timers = seq
      .slice(1)
      .map((v, idx) => window.setTimeout(() => setValue(v), Math.round(((idx + 1) * durationMs) / seq.length)));
    return () => timers.forEach(window.clearTimeout);
  }, [seq, active, durationMs]);
  return value;
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="agent-think-dot h-[3px] w-[3px] rounded-full bg-current"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}

function AgentNode({ node, mode, cfg, stepDuration, stepKey, arrivalCount, burstPulse, systemActive }) {
  const [hovered, setHovered] = useState(false);
  const progressValue = useProgressSeq(cfg?.progressSeq, mode === 'processing' && !!cfg?.progressSeq, stepDuration);
  const isChief = node.depth === 'chief';
  const isActive = mode !== 'idle';
  const breathing = mode === 'thinking' || mode === 'processing' || mode === 'sending';

  const chiefBadge = mode === 'complete' ? 'WORKFLOW COMPLETE ✓' : systemActive ? 'ORCHESTRATING' : 'STANDBY';

  return (
    <div
      className={clsx(
        'absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center',
        node.depth === 'secondary' && 'scale-[0.92]',
        node.depth === 'chief' && 'z-20'
      )}
      style={{ left: `${node.x}%`, top: `${node.y}%` }}
    >
      {isChief ? (
        <>
          <span
            aria-hidden="true"
            className="absolute -inset-3 rounded-full border border-dashed border-accent/20 animate-spin-slow"
          />
          <span
            aria-hidden="true"
            className="absolute -inset-5 animate-spin-slow"
            style={{ animationDirection: 'reverse', animationDuration: '7s' }}
          >
            <span className="absolute left-1/2 top-0 h-1 w-1 -translate-x-1/2 rounded-full bg-accent-bright shadow-glow-sm" />
          </span>
          {burstPulse && (
            <motion.span
              key={`chief-burst-${stepKey}`}
              initial={{ scale: 0.6, opacity: 0.5 }}
              animate={{ scale: 2.6, opacity: 0 }}
              transition={{ duration: 1.5, ease: 'easeOut' }}
              className="absolute inset-0 rounded-full border border-accent-bright/60"
              aria-hidden="true"
            />
          )}
        </>
      ) : null}

      <motion.div
        tabIndex={0}
        role="group"
        aria-label={`${node.label}, ${node.role}, status ${MODE_LABEL[mode]}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        whileHover={{ y: -3 }}
        animate={mode === 'sending' ? { scale: [1, 1.07, 1] } : { scale: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        key={`pulse-${stepKey}-${mode === 'sending'}`}
        className={clsx(
          'relative flex items-center gap-2 rounded-lg border bg-panel/85 px-2.5 py-1.5 backdrop-blur-xl outline-none transition-colors duration-500 focus-visible:border-accent/60',
          isChief && 'px-3 py-2',
          MODE_RING[mode],
          isActive ? 'opacity-100 shadow-glow-sm' : 'opacity-55 shadow-panel',
          breathing && 'agent-breathe'
        )}
      >
        {arrivalCount > 0 && (
          <span
            key={arrivalCount}
            aria-hidden="true"
            className="agent-arrival-ring pointer-events-none absolute inset-0 rounded-full border-2 border-accent-bright/70"
          />
        )}
        {mode === 'complete' && (
          <motion.span
            key={stepKey}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: [0, 1, 0], scale: [0.6, 1.15, 1] }}
            transition={{ duration: 1 }}
            className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-status-good text-[9px] text-void"
            aria-hidden="true"
          >
            ✓
          </motion.span>
        )}

        <span
          className={clsx(
            'relative flex shrink-0 items-center justify-center rounded-md bg-panel-raised',
            isChief ? 'h-7 w-7 text-base' : 'h-6 w-6 text-sm'
          )}
        >
          {node.icon}
          <span
            aria-hidden="true"
            className={clsx(
              'absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-panel',
              isActive ? 'bg-status-good animate-pulse-glow' : 'bg-ink-faint/60'
            )}
          />
        </span>

        <span className="min-w-0 whitespace-nowrap text-left leading-tight">
          <span className={clsx('block font-semibold text-ink', isChief ? 'text-[12px]' : 'text-[11px]')}>
            {node.label}
          </span>
          <span className="block text-[9px] uppercase tracking-wide text-ink-faint">{node.role}</span>

          {mode === 'tool_call' && cfg?.label ? (
            <span className="mt-0.5 flex items-center gap-1 font-mono text-[9px] text-accent-violet">
              <span aria-hidden="true">⚡</span>
              {cfg.label}
            </span>
          ) : mode === 'thinking' && cfg?.label ? (
            <span className="mt-0.5 flex items-center gap-1 text-[9px] text-ink-faint">
              {cfg.label}
              <ThinkingDots />
            </span>
          ) : cfg?.label ? (
            <span className="mt-0.5 block truncate text-[9px] text-ink-faint">{cfg.label}</span>
          ) : null}

          {cfg?.metrics ? (
            <span className="mt-1 block space-y-0.5">
              {cfg.metrics.map((m) => (
                <span key={m} className="block text-[9px] leading-tight text-ink-faint">
                  {m}
                </span>
              ))}
            </span>
          ) : null}

          {cfg?.progressSeq ? (
            <span className="mt-1 block w-24">
              <span className="block h-1 w-full overflow-hidden rounded-full bg-panel-sunken">
                <motion.span
                  className="block h-full rounded-full bg-gradient-to-r from-accent to-accent-violet"
                  animate={{ width: `${progressValue}%` }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                />
              </span>
              <span className="mt-0.5 block text-[9px] tabular text-ink-faint">{progressValue}%</span>
            </span>
          ) : null}
        </span>
      </motion.div>

      {isChief && (
        <span
          className={clsx(
            'mt-1.5 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide',
            mode === 'complete'
              ? 'border-status-good/30 bg-status-good/10 text-status-good'
              : 'border-accent/25 bg-accent/10 text-accent-bright'
          )}
        >
          {chiefBadge}
        </span>
      )}

      {hovered && (
        <div
          className={clsx(
            'absolute z-30 w-44 rounded-lg border border-hairline-strong bg-panel-raised/95 p-2.5 text-left shadow-panel backdrop-blur-xl',
            node.y > 60 ? 'bottom-full mb-2' : 'top-full mt-2'
          )}
          style={{ left: '50%', transform: 'translateX(-50%)' }}
        >
          <p className="text-xs font-semibold text-ink">{node.label}</p>
          <p className="text-[10px] text-ink-faint">{node.role}</p>
          <div className="mt-1.5 space-y-0.5 text-[10px] text-ink-secondary">
            <p>
              Status: <span className="text-ink">{MODE_LABEL[mode]}</span>
            </p>
            <p>
              Tasks today: <span className="text-ink">{node.tasksToday}</span>
            </p>
            <p className="truncate">
              Last: <span className="text-ink">{cfg?.label || '—'}</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Compact vertical fallback for narrow viewports — same state, no horizontal network. */
function MobileFlow({ modes, packet, stepKey }) {
  return (
    <div className="relative space-y-1 pl-5">
      <div className="absolute bottom-2 left-[7px] top-2 w-px bg-hairline" aria-hidden="true" />
      {NODES.map((node) => {
        const mode = modes[node.key];
        const isActive = mode !== 'idle';
        return (
          <div key={node.key} className="relative flex items-center gap-2 py-1.5">
            <span
              aria-hidden="true"
              className={clsx(
                'absolute -left-5 h-2.5 w-2.5 rounded-full ring-4 ring-void',
                isActive ? 'bg-accent shadow-glow-sm' : 'bg-ink-faint/50'
              )}
            />
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-panel-raised text-sm">
              {node.icon}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{node.label}</span>
            <AnimatePresence>
              {packet && node.key === packet.to ? (
                <motion.span
                  key={stepKey}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent-bright"
                >
                  {packet.message}
                </motion.span>
              ) : null}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

export default function AgentCommunicationVisualizer() {
  const [stepIndex, setStepIndex] = useState(0);
  const [arrivals, setArrivals] = useState({});
  const [feed, setFeed] = useState([]);
  const [tasksProcessed, setTasksProcessed] = useState(128);
  const [toolCalls, setToolCalls] = useState(43);
  const [successRate, setSuccessRate] = useState(99.8);
  const [burstKey, setBurstKey] = useState(0);
  const [burstActive, setBurstActive] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const feedSeq = useRef(0);

  const step = STEPS[stepIndex];

  // Advance through the script. Each step's own duration plus a little
  // jitter so consecutive loops never land on an identical rhythm.
  useEffect(() => {
    const jitter = Math.floor(Math.random() * 180);
    const timer = window.setTimeout(() => {
      setStepIndex((i) => {
        const next = (i + 1) % STEPS.length;
        if (next === 0) {
          setTasksProcessed((n) => n + 1);
          setSuccessRate((r) => Math.min(99.9, Math.max(99.2, +(r + (Math.random() * 0.4 - 0.2)).toFixed(1))));
        }
        return next;
      });
    }, step.duration + jitter);
    return () => window.clearTimeout(timer);
  }, [stepIndex, step.duration]);

  // Feed + tool-call counter + the delayed "arrival" pulse on the receiver —
  // all keyed to the step itself so they can't drift from what's on screen.
  useEffect(() => {
    if (step.feed) {
      feedSeq.current += 1;
      const entry = {
        id: `s-${feedSeq.current}`,
        time: new Date().toLocaleTimeString([], { hour12: false }),
        from: step.packet ? NODE_MAP[step.packet.from].label : null,
        to: step.packet ? NODE_MAP[step.packet.to].label : null,
        text: step.feed,
      };
      setFeed((prev) => [entry, ...prev].slice(0, 4));
    }
    if (step.agents) {
      Object.values(step.agents).forEach((cfg) => {
        if (cfg.mode === 'tool_call') setToolCalls((n) => n + 1);
      });
    }
    let arrivalTimer;
    if (step.packet) {
      arrivalTimer = window.setTimeout(() => {
        setArrivals((prev) => ({ ...prev, [step.packet.to]: (prev[step.packet.to] || 0) + 1 }));
      }, TRAVEL_S * 1000);
    }
    return () => {
      if (arrivalTimer) window.clearTimeout(arrivalTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on stepIndex only
  }, [stepIndex]);

  // Independent "wow moment" timer: every ~10-15s, fire 2-3 simultaneous
  // packets over edges the scripted workflow never touches, so it reads as
  // genuine parallel activity rather than a repeat of the main loop.
  useEffect(() => {
    let alive = true;
    let mainTimer;
    let offTimer;
    function fire() {
      if (!alive) return;
      setBurstKey((k) => k + 1);
      setBurstActive(true);
      setTasksProcessed((n) => n + 1);
      setToolCalls((n) => n + 1);
      offTimer = window.setTimeout(() => {
        if (alive) setBurstActive(false);
      }, 1800);
      mainTimer = window.setTimeout(fire, 10000 + Math.random() * 5000);
    }
    mainTimer = window.setTimeout(fire, 12000 + Math.random() * 3000);
    return () => {
      alive = false;
      window.clearTimeout(mainTimer);
      window.clearTimeout(offTimer);
    };
  }, []);

  const modes = {};
  NODES.forEach((n) => {
    modes[n.key] = step.agents?.[n.key]?.mode || 'idle';
  });
  const anyActive = Object.values(modes).some((m) => m !== 'idle');
  const chiefIsBursting = burstActive && BURST_EDGES.some((e) => e.from === 'chief_agent' || e.to === 'chief_agent');

  return (
    <Card interactive={false} className="relative overflow-hidden p-5 sm:p-6">
      <div className="pointer-events-none absolute inset-0 bg-glow-subtle opacity-40" aria-hidden="true" />
      <div
        className="pointer-events-none absolute -left-10 -top-16 hidden h-56 w-56 rounded-full bg-accent-violet/20 blur-3xl lg:block"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-16 -right-10 hidden h-56 w-56 rounded-full bg-accent-cyan/10 blur-3xl lg:block"
        aria-hidden="true"
      />

      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-pulse-glow rounded-full bg-status-good" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-status-good" />
            </span>
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink">System Online</h2>
          </div>
          <p className="mt-1 text-xs text-ink-muted">Agents are communicating and executing tasks in real time</p>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
          <span className="tabular">
            <span className="font-semibold text-ink-secondary">{NODES.length}</span> active agents
          </span>
          <span className="text-hairline-strong">·</span>
          <span className="tabular inline-flex items-baseline gap-1">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={tasksProcessed}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.3 }}
                className="font-semibold text-ink-secondary"
              >
                {tasksProcessed}
              </motion.span>
            </AnimatePresence>
            tasks
          </span>
          <span className="text-hairline-strong">·</span>
          <span className="tabular inline-flex items-baseline gap-1">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={toolCalls}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.3 }}
                className="font-semibold text-ink-secondary"
              >
                {toolCalls}
              </motion.span>
            </AnimatePresence>
            tool calls
          </span>
          <span className="text-hairline-strong">·</span>
          <span className="tabular">
            <span className="font-semibold text-ink-secondary">{successRate.toFixed(1)}%</span> success
          </span>
        </div>
      </div>

      {/* Desktop / tablet: full orchestration network. */}
      <div
        className="relative mt-5 hidden min-h-[260px] overflow-hidden rounded-xl border border-hairline bg-panel-sunken/40 md:block"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      >
        {/* Ambient background particles — decorative only, never gate any state. */}
        {!reducedMotion &&
          [
            [6, 30],
            [22, 70],
            [45, 88],
            [70, 25],
            [88, 65],
            [52, 8],
          ].map(([px, py], i) => (
            <span
              key={`amb-${i}`}
              aria-hidden="true"
              className="absolute hidden h-1 w-1 rounded-full bg-accent-bright/25 animate-float lg:block"
              style={{ left: `${px}%`, top: `${py}%`, animationDuration: `${3 + (i % 3)}s`, animationDelay: `${i * 0.4}s` }}
            />
          ))}

        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="agentEdgeGradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#3B82F6" />
              <stop offset="50%" stopColor="#8B5CF6" />
              <stop offset="100%" stopColor="#EC4899" />
            </linearGradient>
          </defs>
          {CONNECTIONS.map((c) => {
            const isScriptedActive = !!step.packet && c.from === step.packet.from && c.to === step.packet.to;
            const isBurstActive =
              burstActive && BURST_EDGES.some((e) => e.from === c.from && e.to === c.to);
            const isActiveEdge = isScriptedActive || isBurstActive;
            const d = edgePath(c.from, c.to, c.bow);
            return (
              <path
                key={`${c.from}-${c.to}`}
                d={d}
                fill="none"
                vectorEffect="non-scaling-stroke"
                stroke={isActiveEdge ? 'url(#agentEdgeGradient)' : 'rgba(255,255,255,0.14)'}
                strokeWidth={isActiveEdge ? 1.6 : 1}
                strokeLinecap="round"
                strokeDasharray="1 5"
                className={clsx(!reducedMotion && 'agent-flow-line', c.tier === 'extra' && 'hidden lg:block')}
                opacity={isActiveEdge ? 0.95 : 1}
              />
            );
          })}
          {!reducedMotion &&
            CONNECTIONS.map((c, i) => (
              <circle
                key={`p-${c.from}-${c.to}`}
                r="0.55"
                fill="#93C5FD"
                opacity="0.5"
                className={c.tier === 'extra' ? 'hidden lg:block' : undefined}
              >
                <animateMotion
                  dur={`${3.4 + (i % 3) * 0.6}s`}
                  begin={`${i * 0.45}s`}
                  repeatCount="indefinite"
                  path={edgePath(c.from, c.to, c.bow)}
                />
              </circle>
            ))}
        </svg>

        {NODES.map((node) => (
          <AgentNode
            key={node.key}
            node={node}
            mode={modes[node.key]}
            cfg={step.agents?.[node.key]}
            stepDuration={step.duration}
            stepKey={stepIndex}
            arrivalCount={arrivals[node.key] || 0}
            burstPulse={node.key === 'chief_agent' ? chiefIsBursting && burstActive : false}
            systemActive={node.key === 'chief_agent' ? anyActive || burstActive : undefined}
          />
        ))}

        <AnimatePresence>
          {step.packet ? (
            <motion.div
              key={stepIndex}
              initial={{ left: `${NODE_MAP[step.packet.from].x}%`, top: `${NODE_MAP[step.packet.from].y}%`, opacity: 0 }}
              animate={{
                left: [`${NODE_MAP[step.packet.from].x}%`, `${NODE_MAP[step.packet.to].x}%`],
                top: [`${NODE_MAP[step.packet.from].y}%`, `${NODE_MAP[step.packet.to].y}%`],
                opacity: [0, 1, 1, 0],
              }}
              transition={{ duration: TRAVEL_S, times: [0, 0.15, 0.82, 1], ease: 'easeInOut' }}
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-accent/40 bg-panel-raised/95 px-2.5 py-1 text-[10px] font-medium text-accent-bright shadow-glow-sm"
            >
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-accent-bright align-middle" aria-hidden="true" />
              {step.packet.message}
            </motion.div>
          ) : null}
        </AnimatePresence>

        {!reducedMotion && burstActive && (
          <AnimatePresence>
            {BURST_EDGES.map((e, i) => (
              <motion.div
                key={`burst-${burstKey}-${i}`}
                initial={{ left: `${NODE_MAP[e.from].x}%`, top: `${NODE_MAP[e.from].y}%`, opacity: 0 }}
                animate={{
                  left: [`${NODE_MAP[e.from].x}%`, `${NODE_MAP[e.to].x}%`],
                  top: [`${NODE_MAP[e.from].y}%`, `${NODE_MAP[e.to].y}%`],
                  opacity: [0, 0.9, 0.9, 0],
                }}
                transition={{ duration: TRAVEL_S, delay: i * 0.12, times: [0, 0.15, 0.82, 1], ease: 'easeInOut' }}
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-accent-violet/40 bg-panel-raised/90 px-2 py-0.5 text-[9px] font-medium text-accent-violet shadow-glow-sm"
              >
                {e.message}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Mobile: compact vertical stack, no horizontal network. */}
      <div className="relative mt-5 rounded-xl border border-hairline bg-panel-sunken/40 p-3 md:hidden">
        <MobileFlow modes={modes} packet={step.packet} stepKey={stepIndex} />
      </div>

      {/* Live event stream, shared by both layouts. */}
      <div className="relative mt-4 space-y-1 border-t border-hairline pt-3">
        <AnimatePresence initial={false}>
          {feed.map((entry, i) => (
            <motion.div
              key={entry.id}
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1 - i * 0.22, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="flex items-center gap-2 text-xs"
            >
              <span className="font-mono text-[10px] text-ink-faint">{entry.time}</span>
              <span className="truncate text-ink-secondary">
                <span className="font-medium text-ink">{entry.from}</span>
                {entry.to ? (
                  <>
                    <span className="mx-1 text-ink-faint">→</span>
                    <span className="font-medium text-ink">{entry.to}</span>
                  </>
                ) : null}
                <span className="mx-1.5 text-ink-faint">·</span>
                {entry.text}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Card>
  );
}
