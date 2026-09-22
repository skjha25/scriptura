// frontend/src/pages/IntelligenceObservatoryPage.js
/**
 * P5-D: Intelligence Observatory — a visualization layer over the existing
 * P0-P5 agentic lifecycle. This page creates, confirms, rejects, reinforces,
 * or evaluates NOTHING — it only polls read-only endpoints
 * (services/agents/observatory.js on the backend) and renders what's
 * already there. Every number, badge, and stream entry traces to a real
 * row; when there's nothing real to show, the UI says so explicitly
 * ("No recent learning activity") rather than inventing a placeholder.
 *
 * REAL-TIME MECHANISM: this codebase has no push infrastructure anywhere
 * (no WebSocket/SSE/event bus — verified before writing this file) and
 * already has an established polling convention for exactly this kind of
 * "watch real backend state change" need (AgentChatWidget.js's own
 * `setInterval` against `GET /agents/activity`). This page follows that
 * same convention rather than introducing anything new.
 *
 * DATA REFRESH vs. ANIMATION: every `setInterval` below only ever re-fetches
 * real data and replaces state with it. Animation (framer-motion, already a
 * project dependency — see BlogGrid.js for the established pattern this
 * file follows) only ever plays in response to that real data actually
 * changing between polls (a new event entering the stream, a counter's
 * value moving) — nothing animates on a timer by itself, and idle sections
 * render a plain, static "No recent activity" state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence, animate } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, Cell } from 'recharts';

import { agentsApi, observatoryApi } from '../lib/api';
import { AGENT_META } from '../lib/agentMeta';
import { Card, CardHeader, Badge, ErrorBanner, Skeleton, EmptyState } from '../components/ui/feedback';
import { STATUS_COLORS } from '../lib/constants';
import { AXIS_PROPS, GRID_PROPS, CHART_MARGIN, NO_MARK_ANIMATION } from '../components/charts/chartTheme';

const SUMMARY_POLL_MS = 8000;
const AGENTS_POLL_MS = 8000;
const ACTIVITY_POLL_MS = 6000;
const ACTIVITY_LIMIT = 30;

const STATE_META = {
  idle: { label: 'Idle', tone: 'neutral', pulse: false },
  working: { label: 'Working', tone: 'accent', pulse: true },
  retrieving_knowledge: { label: 'Retrieving Knowledge', tone: 'accent', pulse: true },
  evaluating_outcome: { label: 'Evaluating Outcome', tone: 'warning', pulse: true },
  reinforcing_knowledge: { label: 'Reinforcing Knowledge', tone: 'good', pulse: true },
  learning_candidate_detected: { label: 'Candidate Detected', tone: 'accent', pulse: true },
  completed: { label: 'Completed', tone: 'good', pulse: false },
  failed: { label: 'Failed', tone: 'critical', pulse: false },
};

const PIPELINE_STAGES = [
  { key: 'recommendation', label: 'Recommendation' },
  { key: 'action', label: 'Action' },
  { key: 'outcome', label: 'Outcome' },
  { key: 'evidence', label: 'Evidence' },
  { key: 'effectiveness', label: 'Effectiveness' },
  { key: 'candidate', label: 'Learning Candidate' },
  { key: 'review', label: 'Human Review' },
  { key: 'knowledge', label: 'Knowledge' },
  { key: 'retrieval', label: 'Future Retrieval' },
];

/** Maps a REAL activity-stream event kind to the ONE pipeline stage it honestly corresponds to. Kinds with no confident single-stage mapping (generic chat/tool activity) map to nothing — never guessed. */
const STAGE_BY_EVENT_KIND = {
  knowledge_retrieval: 'retrieval',
  outcome_evaluated: 'outcome',
  reinforcement: 'evidence',
  learning_candidate_detected: 'candidate',
  candidate_confirmed: 'knowledge',
  candidate_rejected: 'review',
};

/** Count-up animation for one already-real number — never invents a value, only tweens the visible digits from the previous real value to the new one. */
function AnimatedCounter({ value, className = '' }) {
  const [display, setDisplay] = useState(value ?? 0);
  const prevRef = useRef(value ?? 0);

  useEffect(() => {
    if (value === null || value === undefined) return undefined;
    const from = prevRef.current;
    const to = value;
    prevRef.current = value;
    if (from === to) {
      setDisplay(to);
      return undefined;
    }
    const controls = animate(from, to, {
      duration: 0.6,
      ease: 'easeOut',
      onUpdate: (latest) => setDisplay(Math.round(latest)),
    });
    return () => controls.stop();
  }, [value]);

  return <span className={className}>{value === null || value === undefined ? '—' : display}</span>;
}

function CounterTile({ label, value, icon }) {
  return (
    <Card className="p-4" interactive={false}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{label}</p>
        {icon ? (
          <span aria-hidden="true" className="text-accent/70">
            {icon}
          </span>
        ) : null}
      </div>
      <AnimatedCounter value={value} className="mt-1.5 block font-display text-2xl font-semibold leading-none tabular text-ink" />
    </Card>
  );
}

/** Live counters bar — 9 real, bounded COUNT()s from GET /agents/observatory/summary, polled and animated on change only. */
function LiveCountersBar() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await observatoryApi.getSummary();
      setSummary(data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, SUMMARY_POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  if (error && !summary) return <ErrorBanner error={error} onRetry={load} />;

  const tiles = [
    { key: 'activeAgents', label: 'Active Agents', icon: '🧠' },
    { key: 'knowledgeItems', label: 'Knowledge Items', icon: '📚' },
    { key: 'knowledgeUsages', label: 'Knowledge Usages', icon: '🔗' },
    { key: 'pendingCandidates', label: 'Pending Candidates', icon: '⏳' },
    { key: 'contestedKnowledge', label: 'Contested', icon: '⚡' },
    { key: 'actionsInProgress', label: 'Actions In Progress', icon: '⚙️' },
    { key: 'completedActions', label: 'Completed Actions', icon: '✅' },
    { key: 'evaluatedOutcomes', label: 'Evaluated Outcomes', icon: '📊' },
    { key: 'recentLearningEvents', label: 'Recent Events (24h)', icon: '📈' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-9">
      {tiles.map((tile) => (
        <CounterTile key={tile.key} label={tile.label} value={summary ? summary[tile.key] : null} icon={tile.icon} />
      ))}
    </div>
  );
}

/** A small pulsing dot for "this state is actively happening", never shown for idle/terminal states. */
function StatePulseDot() {
  return (
    <span className="relative flex h-2 w-2" aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
    </span>
  );
}

function StateBadge({ state }) {
  const meta = STATE_META[state] || STATE_META.idle;
  return (
    <Badge tone={meta.tone} className="gap-1.5">
      {meta.pulse ? <StatePulseDot /> : null}
      {meta.label}
    </Badge>
  );
}

function formatRelativeTime(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 5000) return 'just now';
  if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

/** One agent's live status card. Selecting it drives the Knowledge Network / Health / Detail panels below. */
function AgentStatusCard({ status, selected, onSelect }) {
  const meta = AGENT_META[status.agentName] || { label: status.agentName, icon: '🤖' };
  return (
    <motion.button
      type="button"
      layout
      data-testid={`agent-status-${status.agentName}`}
      onClick={() => onSelect(status.agentName)}
      className={
        selected
          ? 'w-full rounded-xl border border-accent/40 bg-accent/10 p-4 text-left shadow-glow-sm transition-colors'
          : 'w-full rounded-xl border border-hairline bg-panel-raised/60 p-4 text-left transition-colors hover:border-hairline-strong'
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          <span aria-hidden="true">{meta.icon}</span>
          {meta.label}
        </span>
        <StateBadge state={status.state} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-ink-secondary">
        <span>Knowledge: <strong className="text-ink">{status.knowledgeCount}</strong></span>
        <span>Pending: <strong className="text-ink">{status.pendingCandidates}</strong></span>
        <span>Contested: <strong className={status.contestedKnowledge > 0 ? 'text-status-critical' : 'text-ink'}>{status.contestedKnowledge}</strong></span>
        <span>Outcomes (24h): <strong className="text-ink">{status.recentOutcomes}</strong></span>
      </div>
      <p className="mt-2 text-[11px] text-ink-faint">Last active {formatRelativeTime(status.lastActiveAt)}</p>
    </motion.button>
  );
}

/** Live agent status grid — GET /agents/observatory/agents, polled. */
function AgentStatusGrid({ selectedAgent, onSelectAgent }) {
  const [agents, setAgents] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await observatoryApi.getAgents();
      setAgents(data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, AGENTS_POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  if (error && !agents) return <ErrorBanner error={error} onRetry={load} />;
  if (!agents) return <Skeleton rows={3} />;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {agents.map((status) => (
        <AgentStatusCard key={status.agentName} status={status} selected={selectedAgent === status.agentName} onSelect={onSelectAgent} />
      ))}
    </div>
  );
}

/** The 9-stage lifecycle diagram — the only "active" stage is whichever ONE the single most recent real stream event honestly maps to (see STAGE_BY_EVENT_KIND). No fabricated transitions, no continuous motion. */
function LearningPipeline({ activeStageKey }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1">
      {PIPELINE_STAGES.map((stage, i) => {
        const active = stage.key === activeStageKey;
        return (
          <div key={stage.key} className="flex items-center gap-1.5">
            <motion.div
              animate={active ? { scale: [1, 1.06, 1] } : { scale: 1 }}
              transition={{ duration: 0.5 }}
              className={
                active
                  ? 'whitespace-nowrap rounded-full border border-accent/50 bg-accent/20 px-3 py-1.5 text-xs font-semibold text-accent-bright shadow-glow-sm'
                  : 'whitespace-nowrap rounded-full border border-hairline bg-panel-raised/50 px-3 py-1.5 text-xs text-ink-secondary'
              }
            >
              {stage.label}
            </motion.div>
            {i < PIPELINE_STAGES.length - 1 ? (
              <span aria-hidden="true" className="text-ink-faint">
                →
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

const EVENT_KIND_LABEL = {
  activity: 'Activity',
  knowledge_retrieval: 'Retrieval',
  outcome_evaluated: 'Outcome',
  reinforcement: 'Reinforcement',
  learning_candidate_detected: 'Candidate',
  candidate_confirmed: 'Confirmed',
  candidate_rejected: 'Rejected',
};

function ActivityStreamRow({ event }) {
  const meta = event.agentName ? AGENT_META[event.agentName] : null;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="flex items-start gap-3 border-b border-hairline/60 py-2 text-sm last:border-0"
    >
      <span aria-hidden="true" className="mt-0.5 text-base leading-none">
        {event.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-ink-secondary">
          {meta ? <span className="font-medium text-ink">{meta.label}</span> : null}
          {meta ? ' ' : ''}
          {event.summary}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
          <span>{new Date(event.at).toLocaleTimeString()}</span>
          <span aria-hidden="true">·</span>
          <span>{EVENT_KIND_LABEL[event.kind] || event.kind}</span>
        </p>
      </div>
    </motion.li>
  );
}

/** Real, merged, time-sorted activity stream — GET /agents/observatory/activity, polled and fully replaced each tick (never appended/merged client-side, so a real event can never be double-rendered across polls). */
function ActivityStream({ onStreamChange }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await observatoryApi.getActivity({ limit: ACTIVITY_LIMIT });
      setEvents(data);
      onStreamChange(data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [onStreamChange]);

  useEffect(() => {
    load();
    const id = setInterval(load, ACTIVITY_POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  return (
    <Card as="section" aria-labelledby="activity-stream-heading">
      <CardHeader title={<span id="activity-stream-heading">Learning Activity Stream</span>} subtitle="Real, time-ordered events — never simulated." />
      <div className="px-5 pb-5 pt-2">
        {error && !events ? (
          <ErrorBanner error={error} onRetry={load} />
        ) : !events ? (
          <Skeleton rows={4} />
        ) : events.length === 0 ? (
          <EmptyState title="No recent learning activity" message="Nothing has happened in the last 24 hours — this is not an error, there's simply nothing real to show yet." />
        ) : (
          <ul className="max-h-[420px] overflow-y-auto">
            <AnimatePresence initial={false}>
              {events.map((event) => (
                <ActivityStreamRow key={event.id} event={event} />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </Card>
  );
}

const CONFIDENCE_BUCKET_LABELS = ['0–20%', '20–40%', '40–60%', '60–80%', '80–100%'];
// Reuses the reserved status palette (never an ad-hoc pick) — the bottom two
// buckets share `critical`/`serious`/`warning`/`good` in worst-to-best order;
// there's no fifth reserved tone, so the top bucket repeats `good` rather than
// inventing a new hex value.
const CONFIDENCE_BUCKET_COLORS = [
  STATUS_COLORS.critical,
  STATUS_COLORS.serious,
  STATUS_COLORS.warning,
  STATUS_COLORS.good,
  STATUS_COLORS.good,
];

/** Real per-agent (or platform-wide) knowledge health — GET /agents/observatory/knowledge-health. */
function KnowledgeHealthPanel({ agentName }) {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setHealth(await observatoryApi.getKnowledgeHealth(agentName));
    } catch (err) {
      setError(err);
    }
  }, [agentName]);

  useEffect(() => {
    setHealth(null);
    load();
  }, [load]);

  const chartData = useMemo(
    () => (health ? health.confidenceDistribution.map((count, i) => ({ bucket: CONFIDENCE_BUCKET_LABELS[i], count })) : []),
    [health]
  );

  return (
    <Card as="section" aria-labelledby="knowledge-health-heading">
      <CardHeader
        title={<span id="knowledge-health-heading">Knowledge Health</span>}
        subtitle={agentName ? `${AGENT_META[agentName]?.label || agentName} — global + its own` : 'Select an agent above for a focused view'}
      />
      <div className="px-5 pb-5 pt-2">
        {error ? (
          <ErrorBanner error={error} onRetry={load} />
        ) : !health ? (
          <Skeleton rows={3} />
        ) : health.total === 0 ? (
          <EmptyState title="No knowledge yet" message="Nothing has been taught or confirmed for this scope yet." />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
              <div className="rounded-lg border border-hairline bg-panel p-2.5">
                <p className="text-ink-faint">Total</p>
                <p className="text-lg font-semibold text-ink">{health.total}</p>
              </div>
              <div className="rounded-lg border border-hairline bg-panel p-2.5">
                <p className="text-ink-faint">Confirmed</p>
                <p className="text-lg font-semibold text-status-good">{health.confirmed}</p>
              </div>
              <div className="rounded-lg border border-hairline bg-panel p-2.5">
                <p className="text-ink-faint">Pending Candidates</p>
                <p className="text-lg font-semibold text-status-warning">{health.pendingCandidates}</p>
              </div>
              <div className="rounded-lg border border-hairline bg-panel p-2.5">
                <p className="text-ink-faint">Contested</p>
                <p className="text-lg font-semibold text-status-critical">{health.contested}</p>
              </div>
              <div className="rounded-lg border border-hairline bg-panel p-2.5">
                <p className="text-ink-faint">Evidence (✓/✕)</p>
                <p className="text-lg font-semibold text-ink">
                  {health.totalSuccessEvidence}/{health.totalFailureEvidence}
                </p>
              </div>
            </div>

            <div className="mt-4 h-32">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Confidence distribution</p>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={CHART_MARGIN}>
                  <CartesianGrid {...GRID_PROPS} vertical={false} />
                  <XAxis dataKey="bucket" {...AXIS_PROPS} tick={{ ...AXIS_PROPS.tick, fontSize: 10 }} />
                  <YAxis allowDecimals={false} {...AXIS_PROPS} tick={{ ...AXIS_PROPS.tick, fontSize: 10 }} width={28} />
                  <RechartsTooltip contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} {...NO_MARK_ANIMATION}>
                    {chartData.map((entry, i) => (
                      <Cell key={entry.bucket} fill={CONFIDENCE_BUCKET_COLORS[i]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

const KNOWLEDGE_STATUS_TONE = { unverified: 'neutral', confirmed: 'good', supported: 'good', contested: 'critical', outdated: 'neutral' };

/** One knowledge "node" — a real agent_knowledge row, clickable to load its real connections. */
function KnowledgeNodeCard({ node, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      className={
        selected
          ? 'w-full rounded-lg border border-accent/50 bg-accent/10 p-3 text-left transition-colors'
          : 'w-full rounded-lg border border-hairline bg-panel p-3 text-left transition-colors hover:border-hairline-strong'
      }
    >
      <div className="flex items-center justify-between gap-2">
        <Badge tone={node.scope === 'global' ? 'accent' : 'neutral'}>{node.scope === 'global' ? 'Global' : 'Agent'}</Badge>
        <Badge tone={KNOWLEDGE_STATUS_TONE[node.status] || 'neutral'}>{node.status}</Badge>
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs text-ink">{node.claim}</p>
      <p className="mt-1 text-[10px] text-ink-faint">
        #{node.id} · used {node.usage_count}× · {Math.round((node.confidence || 0) * 100)}% confidence
      </p>
    </button>
  );
}

/** Animated radial connections — a focus knowledge node in the center, its REAL neighbors (recommendations that retrieved it + related/contested knowledge) arranged around it, connected by animated draw-in SVG lines. */
function ConnectionsGraph({ connections }) {
  const neighbors = useMemo(() => {
    const recs = connections.recommendations.slice(0, 5).map((r) => ({ type: 'recommendation', id: r.id, label: `Rec #${r.id}` }));
    const related = connections.relatedKnowledge.map((k) => ({ type: 'knowledge', id: k.id, label: `Knowledge #${k.id}` }));
    return [...recs, ...related].slice(0, 8);
  }, [connections]);

  const size = 260;
  const center = size / 2;
  const radius = 92;

  if (neighbors.length === 0) {
    return <EmptyState title="No connections yet" message="This knowledge item hasn't been retrieved by any recommendation, and has no related knowledge." />;
  }

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-64 w-64" role="img" aria-label="Knowledge connections graph">
      {neighbors.map((n, i) => {
        const angle = (2 * Math.PI * i) / neighbors.length - Math.PI / 2;
        const x = center + radius * Math.cos(angle);
        const y = center + radius * Math.sin(angle);
        return (
          <g key={`${n.type}-${n.id}`}>
            <motion.line
              x1={center}
              y1={center}
              x2={x}
              y2={y}
              stroke="currentColor"
              className={n.type === 'knowledge' ? 'text-status-critical/70' : 'text-accent/50'}
              strokeWidth={1.5}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.5, delay: i * 0.05 }}
            />
            <motion.circle
              cx={x}
              cy={y}
              r={16}
              className={n.type === 'knowledge' ? 'fill-status-critical/20 stroke-status-critical' : 'fill-accent/20 stroke-accent'}
              strokeWidth={1.5}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.3, delay: i * 0.05 + 0.2 }}
            />
            <text x={x} y={y + 3} textAnchor="middle" fontSize={8} className="fill-ink pointer-events-none select-none">
              {n.type === 'knowledge' ? `K#${n.id}` : `R#${n.id}`}
            </text>
          </g>
        );
      })}
      <motion.circle cx={center} cy={center} r={22} className="fill-accent/30 stroke-accent" strokeWidth={2} initial={{ scale: 0.8 }} animate={{ scale: 1 }} />
      <text x={center} y={center + 4} textAnchor="middle" fontSize={9} fontWeight={600} className="fill-ink pointer-events-none select-none">
        #{connections.knowledge.id}
      </text>
    </svg>
  );
}

/** Knowledge Network — pick an agent's most-used knowledge nodes, click one to see its real relationships (recommendations that retrieved it, their actions/outcomes, and any contested/related knowledge). */
function KnowledgeNetwork({ agentName }) {
  const [nodes, setNodes] = useState(null);
  const [nodesError, setNodesError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [connections, setConnections] = useState(null);
  const [connectionsError, setConnectionsError] = useState(null);
  const [connectionsLoading, setConnectionsLoading] = useState(false);

  const loadNodes = useCallback(async () => {
    setNodesError(null);
    try {
      const data = await observatoryApi.getKnowledgeNodes(agentName, 12);
      setNodes(data);
      setSelectedId(null);
      setConnections(null);
    } catch (err) {
      setNodesError(err);
    }
  }, [agentName]);

  useEffect(() => {
    setNodes(null);
    loadNodes();
  }, [loadNodes]);

  const selectNode = useCallback(async (id) => {
    setSelectedId(id);
    setConnectionsLoading(true);
    setConnectionsError(null);
    try {
      setConnections(await observatoryApi.getKnowledgeConnections(id));
    } catch (err) {
      setConnectionsError(err);
    } finally {
      setConnectionsLoading(false);
    }
  }, []);

  return (
    <Card as="section" aria-labelledby="knowledge-network-heading">
      <CardHeader
        title={<span id="knowledge-network-heading">Knowledge Network</span>}
        subtitle="Real relationships only — an edge only exists because a recommendation actually retrieved this knowledge, or it's linked as a contested pair."
        action={
          <Link to="/agents/knowledge" className="text-xs font-medium text-accent-bright hover:underline">
            Open Knowledge Review →
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-4 px-5 pb-5 pt-2 lg:grid-cols-[1fr_260px]">
        <div>
          {nodesError ? (
            <ErrorBanner error={nodesError} onRetry={loadNodes} />
          ) : !nodes ? (
            <Skeleton rows={3} />
          ) : nodes.length === 0 ? (
            <EmptyState title="No knowledge yet" message="Nothing has been taught or confirmed for this agent yet." />
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {nodes.map((node) => (
                <KnowledgeNodeCard key={node.id} node={node} selected={selectedId === node.id} onSelect={selectNode} />
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col items-center justify-center rounded-xl border border-hairline bg-panel-sunken/40 p-3">
          {!selectedId ? (
            <p className="px-2 text-center text-xs text-ink-faint">Select a knowledge item to see its real connections.</p>
          ) : connectionsLoading ? (
            <Skeleton rows={3} />
          ) : connectionsError ? (
            <ErrorBanner error={connectionsError} onRetry={() => selectNode(selectedId)} />
          ) : connections ? (
            <>
              <ConnectionsGraph connections={connections} />
              <p className="mt-2 text-center text-[11px] text-ink-faint">
                {connections.recommendations.length} recommendation{connections.recommendations.length === 1 ? '' : 's'} retrieved this ·{' '}
                {connections.relatedKnowledge.length} related
              </p>
            </>
          ) : null}
        </div>
      </div>

      {selectedId && connections ? <KnowledgeDetailPanel connections={connections} /> : null}
    </Card>
  );
}

/** Full detail for one selected knowledge node — claim, scope, confidence, evidence counts, provenance, and every real related record. No editing controls (none exist in the existing knowledge UI either). */
function KnowledgeDetailPanel({ connections }) {
  const k = connections.knowledge;
  return (
    <div className="border-t border-hairline px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={k.scope === 'global' ? 'accent' : 'neutral'}>{k.scope === 'global' ? 'Global' : `Agent: ${AGENT_META[k.agent_name]?.label || k.agent_name}`}</Badge>
        <Badge tone={KNOWLEDGE_STATUS_TONE[k.status] || 'neutral'}>{k.status}</Badge>
        <span className="text-xs text-ink-faint">#{k.id}</span>
      </div>
      <p className="mt-2 text-sm text-ink">{k.claim}</p>
      {k.evidence ? <p className="mt-1 text-xs text-ink-secondary">{k.evidence}</p> : null}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-secondary">
        <span>Confidence: <strong className="text-ink">{Math.round((k.confidence || 0) * 100)}%</strong></span>
        <span className="text-status-good">Success: {k.success_count}</span>
        <span className="text-status-critical">Failure: {k.failure_count}</span>
        <span>Usage: {k.usage_count}</span>
        <span>Last validated: {k.last_verified_at ? new Date(k.last_verified_at).toLocaleDateString() : 'never'}</span>
      </div>

      {connections.recommendations.length > 0 ? (
        <div className="mt-3">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Related recommendations</p>
          <ul className="space-y-1 text-xs text-ink-secondary">
            {connections.recommendations.map((r) => {
              const relatedOutcome = connections.outcomes.find((o) => o.recommendation_id === r.id);
              const relatedAction = connections.actions.find((a) => a.recommendation_id === r.id);
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-panel px-2 py-1">
                  <span>Recommendation #{r.id}</span>
                  {relatedAction ? <Badge tone="neutral">{relatedAction.status}</Badge> : null}
                  {relatedOutcome ? (
                    <Badge tone={relatedOutcome.outcome === 'improved' ? 'good' : relatedOutcome.outcome === 'declined' ? 'critical' : 'neutral'}>
                      {relatedOutcome.outcome || relatedOutcome.status}
                    </Badge>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {connections.relatedKnowledge.length > 0 ? (
        <div className="mt-3">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Contested / related knowledge</p>
          <ul className="space-y-1 text-xs text-ink-secondary">
            {connections.relatedKnowledge.map((r) => (
              <li key={r.id} className="rounded-md border border-status-critical/30 bg-status-critical/5 px-2 py-1">
                #{r.id}: {r.claim}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Pending candidates + contested knowledge, each deep-linking to the existing review UI — reuses the existing learning-candidates API verbatim, no new data source. */
function LearningQueue({ agentName }) {
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPending(await agentsApi.listLearningCandidates({ status: 'pending_review', ...(agentName ? { agent_name: agentName } : {}) }));
    } catch (err) {
      setError(err);
    }
  }, [agentName]);

  useEffect(() => {
    setPending(null);
    load();
  }, [load]);

  return (
    <Card as="section" aria-labelledby="learning-queue-heading">
      <CardHeader
        title={<span id="learning-queue-heading">Learning Queue</span>}
        subtitle="Awaiting human review"
        action={
          <Link to="/agents/knowledge" className="text-xs font-medium text-accent-bright hover:underline">
            Review now →
          </Link>
        }
      />
      <div className="px-5 pb-5 pt-2">
        {error ? (
          <ErrorBanner error={error} onRetry={load} />
        ) : !pending ? (
          <Skeleton rows={2} />
        ) : pending.length === 0 ? (
          <EmptyState title="Queue is empty" message="No candidates are currently awaiting review." />
        ) : (
          <ul className="space-y-2">
            {pending.slice(0, 6).map((c) => (
              <li key={c.id} className="rounded-md border border-hairline bg-panel p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-ink">{AGENT_META[c.agent_name]?.label || c.agent_name}</span>
                  <Badge tone="warning">Pending Review</Badge>
                </div>
                <p className="mt-1 text-ink-secondary line-clamp-2">{c.claim}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export default function IntelligenceObservatoryPage() {
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [latestEventKind, setLatestEventKind] = useState(null);

  const handleStreamChange = useCallback((events) => {
    setLatestEventKind(events && events.length > 0 ? events[0].kind : null);
  }, []);

  const activeStageKey = latestEventKind ? STAGE_BY_EVENT_KIND[latestEventKind] || null : null;

  return (
    <div className="space-y-8 animate-fade-in-up">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Intelligence Observatory</h1>
        <p className="max-w-2xl text-base text-ink-secondary">
          A live, read-only view of what Scriptura&apos;s agents are actually doing, learning, and reinforcing — every
          number and event here traces to a real row. Nothing on this page can approve, execute, teach, or confirm
          anything; it only watches the existing recommendation → outcome → learning → knowledge lifecycle.
        </p>
      </header>

      <LiveCountersBar />

      <Card as="section" aria-labelledby="pipeline-heading">
        <CardHeader title={<span id="pipeline-heading">Live Learning Pipeline</span>} subtitle="The active stage reflects the single most recent real event — nothing here is animated on a timer." />
        <div className="px-5 pb-5 pt-2">
          <LearningPipeline activeStageKey={activeStageKey} />
        </div>
      </Card>

      <section aria-labelledby="agent-status-heading">
        <h2 id="agent-status-heading" className="mb-3 text-lg font-semibold text-ink">
          Live Agent Status
        </h2>
        <AgentStatusGrid selectedAgent={selectedAgent} onSelectAgent={(name) => setSelectedAgent((prev) => (prev === name ? null : name))} />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ActivityStream onStreamChange={handleStreamChange} />
        <KnowledgeHealthPanel agentName={selectedAgent} />
      </div>

      <KnowledgeNetwork agentName={selectedAgent} />

      <LearningQueue agentName={selectedAgent} />
    </div>
  );
}
