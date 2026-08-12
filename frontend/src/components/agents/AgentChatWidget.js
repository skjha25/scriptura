// frontend/src/components/agents/AgentChatWidget.js
/**
 * Floating chat widget for talking directly to one (or, via a small tab
 * switcher, one of a few) admin agent(s) — never routes through the Chief
 * Agent from the UI. Mounted per-page, scoped to whichever agent(s) are
 * relevant there (see WizardPage.js / AutomatedBlogPage.js).
 *
 * Safety contract mirrored here from the backend: a proposed change is only
 * ever a diff card with Apply/Dismiss buttons. Nothing is written to
 * ScripturaSettings until the admin explicitly clicks Apply, which hits
 * POST /agents/settings/apply — the same re-validated endpoint regardless of
 * which agent proposed the change.
 */

import { useCallback, useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { agentsApi, autopilotSettingsApi, knowledgeApi } from '../../lib/api';
import { AGENT_META } from '../../lib/agentMeta';
import Button from '../ui/Button';
import { Textarea } from '../ui/form';
import { ErrorBanner } from '../ui/feedback';

/**
 * Minimal element-to-Tailwind-class mapping for an agent's markdown reply —
 * headers, bold, lists, and (agents reply with these constantly) tables.
 * No `@tailwindcss/typography` dependency; small enough to hand-map directly
 * rather than pull in a second package for a chat bubble's worth of styling.
 */
const MARKDOWN_COMPONENTS = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  h1: ({ children }) => <h3 className="mb-1.5 mt-2 text-sm font-semibold text-ink first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-1.5 mt-2 text-sm font-semibold text-ink first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1 mt-2 text-xs font-semibold text-ink first:mt-0">{children}</h4>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-0.5 pl-4 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-0.5 pl-4 last:mb-0">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  code: ({ children }) => <code className="rounded bg-void/60 px-1 py-0.5 text-[0.8em]">{children}</code>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-bright underline">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-hairline px-2 py-1 text-left font-semibold text-ink">{children}</th>,
  td: ({ children }) => <td className="border-b border-hairline/50 px-2 py-1 align-top">{children}</td>,
};

/** 'get_current_style_profile' -> 'Get Current Style Profile' — tool names are snake_case, status text shouldn't be. */
function prettifyToolName(name) {
  return String(name || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Turns the latest agent_activity row for an in-flight turn into a short,
 * human-readable status line — what the polling loop in handleSend below
 * shows while a chat turn (which can involve several tool calls and, for the
 * Chief Agent, a whole delegation chain) is still running server-side.
 */
function describeActivityRow(row) {
  switch (row?.event_type) {
    case 'delegation':
      return `Delegating to ${AGENT_META[row.to_agent]?.label || row.to_agent}...`;
    case 'tool_call':
      return `Running ${prettifyToolName(row.tool_name)}...`;
    case 'setting_proposed':
      return 'Preparing a proposed change...';
    case 'error':
      return 'Hit a snag, retrying...';
    default:
      return 'Thinking...';
  }
}

/** Renders an agent's reply as markdown — user messages stay plain text (see below), they're never markdown. */
function MarkdownMessage({ text }) {
  return (
    <div className="text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** Per-step type -> icon + short label + optional detail line, for the collapsible steps trail. */
function describeStep({ name, result }) {
  const type = result?.type;
  if (type === 'delegation') {
    const target = AGENT_META[result.toAgent]?.label || result.toAgent;
    return { icon: '🧭', label: `Delegated to ${target}`, detail: result.instruction, critical: false };
  }
  if (type === 'proposed_change') {
    return { icon: '📝', label: `Proposed via ${prettifyToolName(name)}`, detail: result.message, critical: false };
  }
  if (type === 'error') {
    return { icon: '⚠️', label: `${prettifyToolName(name)} failed`, detail: result.error, critical: true };
  }
  return { icon: '🔎', label: `Checked ${prettifyToolName(name)}`, detail: null, critical: false };
}

/**
 * Collapsible "how did you get here" trail under an assistant reply — the
 * tool_call/delegation steps that produced it (see `steps` on the message
 * object in handleSend). Renders nothing when there's nothing to show: a
 * reloaded-history message (no toolCalls data survives a reload) or a turn
 * that answered with zero tool calls.
 */
function TurnSteps({ steps }) {
  const [open, setOpen] = useState(false);
  if (!steps || steps.length === 0) return null;

  return (
    <div className="mt-1.5 max-w-[85%]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-xs text-ink-faint transition-colors hover:text-ink-secondary"
        aria-expanded={open}
      >
        <span className={clsx('inline-block text-[10px] transition-transform duration-200', open && 'rotate-90')}>
          ▸
        </span>
        {open ? 'Hide steps' : `Show steps (${steps.length})`}
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.ol
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="ml-1 mt-2 space-y-2.5 overflow-hidden border-l border-hairline pl-3"
          >
            {steps.map((step, i) => {
              const { icon, label, detail, critical } = describeStep(step);
              return (
                <li key={i} className="relative text-xs">
                  <span
                    className="absolute -left-[21px] top-0 flex h-4 w-4 items-center justify-center rounded-full bg-panel-sunken text-[9px] ring-2 ring-panel"
                    aria-hidden="true"
                  >
                    {icon}
                  </span>
                  <p className={clsx('font-medium', critical ? 'text-status-critical' : 'text-ink-secondary')}>
                    {label}
                  </p>
                  {detail ? <p className="mt-0.5 line-clamp-2 text-ink-faint">{detail}</p> : null}
                </li>
              );
            })}
          </motion.ol>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/**
 * "What knowledge influenced this answer" — rendered from GET
 * /agents/knowledge-usage, fetched after a turn completes (see handleSend).
 * Renders nothing when a turn retrieved no knowledge, which is the common
 * case for most turns, so this stays invisible rather than showing an empty line.
 */
function KnowledgeUsageNote({ usage }) {
  if (!usage || usage.length === 0) return null;
  return (
    <p className="mt-1 max-w-[85%] text-xs text-ink-faint">
      Knowledge used:{' '}
      {usage
        .map((u) => `#${u.knowledge_id} (${Math.round((u.relevance_score || 0) * 100)}%)`)
        .join(', ')}
    </p>
  );
}

/** Builds the /agents/settings/apply body for a proposed change, key-aware. */
function buildApplyPayload(change, traceId) {
  if (change.key === 'agents.image.style_overrides') {
    return { key: change.key, style: change.style, directive_text: change.proposed_value, trace_id: traceId };
  }
  if (change.key === 'agents.generate.content_defaults') {
    return { key: change.key, ...change.proposed_value, trace_id: traceId };
  }
  return { key: change.key, trace_id: traceId };
}

/** Builds the /agents/settings/revert body for a previously-applied change, key-aware. */
function buildRevertPayload(change) {
  if (change.key === 'agents.image.style_overrides') {
    return { key: change.key, style: change.style };
  }
  return { key: change.key };
}

/** Actions whose proposed_value is a scalar/array that must be nested under a
 * named field rather than spread — spreading a string or array copies its
 * characters/indices as numeric keys instead of setting the real field. */
const PROPOSAL_VALUE_FIELD = {
  'cluster.update_status': 'status',
  'cluster.update_keyword_date': 'scheduled_generation_date',
  'cluster.reschedule': 'schedule',
  'cluster.expand': 'keywords',
};

/**
 * Builds the single-item batch for POST /agents/:agentName/knowledge-base/confirm
 * from a propose_knowledge_update change — reuses the exact write path the
 * Teach panel's draft review already uses (knowledgeApi.confirm), rather than
 * a parallel persistence mechanism. `decision: 'accept'` because the admin
 * clicking Apply on this card IS the accept decision.
 */
function buildKnowledgeConfirmItem(change) {
  return {
    decision: 'accept',
    category: change.category,
    topic: change.topic,
    claim: change.claim,
    evidence: change.evidence,
    knowledge_type: change.knowledge_type,
    source_type: change.source_type,
  };
}

/** Builds the /agents/proposals/apply body for an entity-mutation proposal, action-aware. */
function buildProposalApplyPayload(change, traceId) {
  if (change.action === 'topics.create_topics') {
    return { action: change.action, topics: change.proposed_value, trace_id: traceId };
  }
  if (change.action === 'keyword_pool.create_keywords') {
    return { action: change.action, keywords: change.proposed_value, trace_id: traceId };
  }
  // cluster.* actions carry cluster_id/keyword_id alongside proposed_value —
  // spreading proposed_value plus whatever identifying fields the tool put
  // directly on `change` covers those without a branch per action, except
  // where proposed_value itself is a scalar/array (see PROPOSAL_VALUE_FIELD).
  const { domain, action, key, current_value, proposed_value, revertible, ...identifiers } = change;
  const valueField = PROPOSAL_VALUE_FIELD[action];
  if (valueField) {
    return { action, ...identifiers, [valueField]: proposed_value, trace_id: traceId };
  }
  return { action, ...identifiers, ...proposed_value, trace_id: traceId };
}

// Keys folded into AUTOPILOT_DEFAULTS / PUT /settings/autopilot on the
// backend (settings.controller.js) even though one of them isn't actually an
// autopilot setting — see autopilotAgentTools.js for why context_exchanges
// lives here (the Autopilot Scheduler Agent proposes it).
const AUTOPILOT_SETTINGS_KEYS = ['autopilot.max_retries', 'agents.chat.context_exchanges'];

/**
 * Decides which of the four Apply mechanisms a proposed change needs. Kept
 * as one function rather than inlined branching in handleApply, so a future
 * 5th mechanism is a one-function change:
 *   - 'local'    — blog_ops block edits, applied via a caller-supplied
 *                  callback (no network call — see EditorPage.js).
 *   - 'proposal' — entity mutations (cluster/keyword_pool/topics),
 *                  POST /agents/proposals/apply.
 *   - 'autopilot'— AUTOPILOT_SETTINGS_KEYS, reuses the existing
 *                  PUT /settings/autopilot mechanism (not the agent-settings one).
 *   - 'setting'  — everything else (image style / content defaults),
 *                  the original POST /agents/settings/apply.
 */
function resolveApplyStrategy(change, { hasLocalApply } = {}) {
  if (hasLocalApply && change.domain === 'blog_ops') return 'local';
  if (change.domain === 'cluster' || change.domain === 'keyword_pool' || change.domain === 'topics') return 'proposal';
  if (change.domain === 'knowledge') return 'knowledge';
  if (AUTOPILOT_SETTINGS_KEYS.includes(change.key)) return 'autopilot';
  return 'setting';
}

// Matches both a bare date ("2026-08-15") and an ISO datetime
// ("2026-08-15T10:29:00[.000][Z]") — the two shapes the proposal tools emit
// (seasonal_peak_date vs. scheduled_generation_date/suggested_publish_date).
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?Z?)?$/;

// Same locale/timezone/12h convention ClusterDetailPage.js already shows the
// admin, so a proposal reads exactly like the applied result will.
const PROPOSAL_DATETIME_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const PROPOSAL_DATE_ONLY_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** Reformats an ISO date/datetime string for display; passes anything else through untouched. */
function formatIfDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return value.includes('T')
    ? `${PROPOSAL_DATETIME_FORMATTER.format(parsed)} IST`
    : PROPOSAL_DATE_ONLY_FORMATTER.format(parsed);
}

/** Renders a proposed value for the diff card — strings inline, objects as a small list. */
function ValuePreview({ value }) {
  if (value === null || value === undefined || value === '') {
    return <span className="italic text-ink-faint">none</span>;
  }
  if (typeof value === 'string') return <span>{formatIfDate(value)}</span>;
  // Numbers/booleans (e.g. autopilot.max_retries, agents.chat.context_exchanges)
  // have no own enumerable properties — Object.entries would silently render
  // an empty list below instead of the value.
  if (typeof value !== 'object') return <span>{String(value)}</span>;
  return (
    <ul className="space-y-0.5">
      {Object.entries(value).map(([field, val]) => (
        <li key={field}>
          <span className="text-ink-faint">{field}:</span> {String(formatIfDate(val))}
        </li>
      ))}
    </ul>
  );
}

function ProposedChangeCard({ change, status, onApply, onDismiss, onRevert }) {
  return (
    <div className="mt-2 rounded-lg border border-accent/25 bg-accent/5 p-3 text-xs">
      <p className="mb-2 font-medium text-ink">
        Proposed change
        {change.style ? ` — ${change.style}` : ''}
        {change.domain === 'knowledge' ? ` — new knowledge (${change.scope === 'global' ? 'global' : 'this agent'})` : ''}
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-ink-faint">Current</p>
          <ValuePreview value={change.current_value} />
        </div>
        <div>
          <p className="mb-1 text-ink-faint">Proposed</p>
          <ValuePreview value={change.proposed_value} />
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        {status === 'applied' ? (
          <>
            <span className="inline-flex items-center text-status-good">Applied</span>
            {change.revertible === false ? null : (
              <Button type="button" variant="ghost" size="sm" onClick={onRevert}>
                Revert
              </Button>
            )}
          </>
        ) : status === 'reverted' ? (
          <span className="inline-flex items-center text-ink-faint">Reverted</span>
        ) : status === 'dismissed' ? (
          <span className="inline-flex items-center text-ink-faint">Dismissed</span>
        ) : (
          <>
            <Button type="button" variant="primary" size="sm" loading={status === 'applying'} onClick={onApply}>
              Apply
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onDismiss} disabled={status === 'applying'}>
              Dismiss
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export default function AgentChatWidget({ agents, defaultAgent, onApplyProposal, context, variant = 'floating' }) {
  const isHeader = variant === 'header';
  const [open, setOpen] = useState(false);
  const [activeAgent, setActiveAgent] = useState(defaultAgent || agents[0]);
  // Keyed by agent name so switching tabs doesn't lose the other agent's thread.
  const [messagesByAgent, setMessagesByAgent] = useState({});
  const [traceByAgent, setTraceByAgent] = useState({});
  const [changeStatus, setChangeStatus] = useState({}); // { [messageId:changeIndex]: 'applying'|'applied'|... }
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  // What the in-flight turn is doing right now — polled from the audit log
  // while a send is outstanding (see handleSend), so a slow Chief Agent
  // delegation chain shows live progress instead of a blank wait.
  const [statusText, setStatusText] = useState('');
  const statusPollRef = useRef(null);
  // Which agents' history has already been requested this session — a Ref, not
  // state, because marking an agent "loaded" must happen synchronously with
  // the fetch that starts (before its promise resolves) so a fast tab switch
  // back and forth can't fire the same history request twice.
  const loadedHistoryAgents = useRef(new Set());
  const [historyLoading, setHistoryLoading] = useState(false);
  const listRef = useRef(null);
  const nextMessageId = useRef(0);

  const messages = messagesByAgent[activeAgent] || [];

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length, open]);

  // Belt-and-braces: stop the status poll if the widget unmounts mid-turn.
  useEffect(() => () => clearInterval(statusPollRef.current), []);

  // Reload this admin's last conversation with the active agent from the DB —
  // once per agent per widget mount, only when the panel is actually open (no
  // point spending a request on a tab nobody's looking at). If the admin
  // already started typing/sending before this resolves, the functional
  // updates below leave that alone rather than clobbering it.
  useEffect(() => {
    if (!open) return;
    if (loadedHistoryAgents.current.has(activeAgent)) return;
    loadedHistoryAgents.current.add(activeAgent);

    setHistoryLoading(true);
    agentsApi
      .getHistory(activeAgent)
      .then((result) => {
        if (result?.messages?.length) {
          setMessagesByAgent((prev) => {
            if ((prev[activeAgent] || []).length > 0) return prev;
            return {
              ...prev,
              [activeAgent]: result.messages.map((m) => ({
                id: nextMessageId.current++,
                role: m.role,
                text: m.content,
                proposedChanges: [],
              })),
            };
          });
        }
        if (result?.traceId) {
          setTraceByAgent((prev) => (prev[activeAgent] ? prev : { ...prev, [activeAgent]: result.traceId }));
        }
      })
      .catch(() => {}) // best-effort — a failed history load just leaves the widget starting blank, same as before this existed
      .finally(() => setHistoryLoading(false));
  }, [open, activeAgent]);

  const handleClearChat = useCallback(async () => {
    const agent = activeAgent;
    setError(null);
    try {
      await agentsApi.clearHistory(agent);
    } catch (err) {
      setError(err);
      return;
    }
    setMessagesByAgent((prev) => ({ ...prev, [agent]: [] }));
    // Dropping the stored trace_id means the next message starts a brand-new
    // trace — the model gets a clean slate too, not just the visible UI.
    setTraceByAgent((prev) => ({ ...prev, [agent]: undefined }));
  }, [activeAgent]);

  const appendMessage = useCallback((agentName, message) => {
    const id = nextMessageId.current;
    nextMessageId.current += 1;
    setMessagesByAgent((prev) => ({
      ...prev,
      [agentName]: [...(prev[agentName] || []), { ...message, id }],
    }));
    return id;
  }, []);

  const handleSend = useCallback(
    async (e) => {
      e.preventDefault();
      const text = input.trim();
      // historyLoading guard matters here, not just for UX: sending while the
      // trace-restore fetch below is still in flight would mint a brand-new
      // trace_id (see turnTraceId below) before the real continuing one
      // arrives — orphaning the message onto a disconnected, empty-history
      // trace and making the agent reply as if the conversation never happened.
      if (!text || sending || historyLoading) return;

      setInput('');
      setError(null);
      appendMessage(activeAgent, { role: 'user', text });
      setSending(true);
      setStatusText('Thinking...');

      // Minted client-side (rather than left for the backend to generate)
      // specifically so it's known BEFORE the response comes back — the chat
      // endpoint accepts a client-supplied trace_id already (for continuing
      // a conversation), so reusing that same mechanism here lets the status
      // poll below start watching this exact turn immediately, even on the
      // very first message of a brand-new conversation.
      const turnTraceId = traceByAgent[activeAgent] || crypto.randomUUID();
      if (!traceByAgent[activeAgent]) {
        setTraceByAgent((prev) => ({ ...prev, [activeAgent]: turnTraceId }));
      }

      // Chief Agent turns can involve several tool calls and a whole
      // delegation chain server-side before the HTTP response returns — each
      // step is logged to agent_activity as it happens, so polling that feed
      // (already-existing GET /agents/activity) surfaces live progress
      // without needing a streaming/websocket endpoint.
      clearInterval(statusPollRef.current);
      statusPollRef.current = setInterval(async () => {
        try {
          const rows = await agentsApi.listActivity({ trace_id: turnTraceId, limit: 1 });
          if (rows?.[0]) setStatusText(describeActivityRow(rows[0]));
        } catch {
          // Best-effort only — a failed poll must never surface as a chat error.
        }
      }, 900);

      try {
        const result = await agentsApi.chat(activeAgent, {
          message: text,
          trace_id: turnTraceId,
          // Only sent when the host page provides it (currently just the
          // Editor page's {blog_id, blocks}) — a fresh read each send, not a
          // value captured once, so a long conversation still sees edits
          // made between messages.
          ...(context ? { context } : {}),
        });
        setTraceByAgent((prev) => ({ ...prev, [activeAgent]: result.trace_id }));
        const assistantMessageId = appendMessage(activeAgent, {
          role: 'assistant',
          text: result.reply,
          proposedChanges: result.proposedChanges || [],
          // Only populated for turns answered live this session — history
          // reloaded from GET /agents/:agentName/history only reconstructs
          // message text, not the tool_call/delegation trail behind it.
          steps: result.toolCalls || [],
        });
        // Best-effort, non-blocking: patches the just-appended message once
        // the trace's usage rows are available, rather than delaying the
        // reply itself on a second round trip.
        const usageAgent = activeAgent;
        agentsApi
          .getKnowledgeUsage(result.trace_id)
          .then((usage) => {
            if (!usage || usage.length === 0) return;
            setMessagesByAgent((prev) => ({
              ...prev,
              [usageAgent]: (prev[usageAgent] || []).map((m) =>
                m.id === assistantMessageId ? { ...m, knowledgeUsage: usage } : m
              ),
            }));
          })
          .catch(() => {
            // Best-effort only — same posture as the status poll above.
          });
      } catch (err) {
        setError(err);
      } finally {
        clearInterval(statusPollRef.current);
        statusPollRef.current = null;
        setSending(false);
        setStatusText('');
      }
    },
    [input, sending, historyLoading, activeAgent, traceByAgent, appendMessage, context]
  );

  const handleApply = useCallback(
    async (messageId, changeIndex, change) => {
      const statusKey = `${messageId}:${changeIndex}`;
      setChangeStatus((prev) => ({ ...prev, [statusKey]: 'applying' }));
      setError(null);
      const strategy = resolveApplyStrategy(change, { hasLocalApply: Boolean(onApplyProposal) });
      try {
        if (strategy === 'local') {
          const applied = onApplyProposal(change);
          if (applied === false) throw new Error('Could not apply this change locally.');
        } else if (strategy === 'proposal') {
          await agentsApi.applyProposal(buildProposalApplyPayload(change, traceByAgent[activeAgent]));
        } else if (strategy === 'autopilot') {
          await autopilotSettingsApi.update({ scope: 'org', settings: { [change.key]: change.proposed_value } });
        } else if (strategy === 'knowledge') {
          // change.agent_name is the tool's own agent (may differ from
          // activeAgent in a Chief Agent delegation chain) — always the
          // agent this knowledge should actually be written against.
          await knowledgeApi.confirm(change.agent_name || activeAgent, [buildKnowledgeConfirmItem(change)], change.scope);
        } else {
          await agentsApi.applySetting(buildApplyPayload(change, traceByAgent[activeAgent]));
        }
        setChangeStatus((prev) => ({ ...prev, [statusKey]: 'applied' }));
      } catch (err) {
        setError(err);
        setChangeStatus((prev) => ({ ...prev, [statusKey]: undefined }));
      }
    },
    [activeAgent, traceByAgent, onApplyProposal]
  );

  const handleRevert = useCallback(async (messageId, changeIndex, change) => {
    const statusKey = `${messageId}:${changeIndex}`;
    setChangeStatus((prev) => ({ ...prev, [statusKey]: 'reverting' }));
    setError(null);
    try {
      await agentsApi.revertSetting(buildRevertPayload(change));
      setChangeStatus((prev) => ({ ...prev, [statusKey]: 'reverted' }));
    } catch (err) {
      setError(err);
      setChangeStatus((prev) => ({ ...prev, [statusKey]: 'applied' }));
    }
  }, []);

  const handleDismiss = useCallback(
    (messageId, changeIndex, change) => {
      const statusKey = `${messageId}:${changeIndex}`;
      // UI state update is immediate and unconditional — the dismiss log call
      // below is audit-trail only (see agentActivityLogger.settingDismissed)
      // and must never block or undo the dismissal if it fails.
      setChangeStatus((prev) => ({ ...prev, [statusKey]: 'dismissed' }));
      agentsApi
        .dismissChange(change?.agent_name || activeAgent, {
          trace_id: traceByAgent[activeAgent],
          setting_key: change?.key || change?.domain || null,
          proposed_value: change?.proposed_value ?? null,
        })
        .catch(() => {
          // Fire-and-forget — see agentActivityLogger.settingDismissed's own
          // fail-open contract; a logging failure must never surface to the admin.
        });
    },
    [activeAgent, traceByAgent]
  );

  const showTabs = agents.length > 1;
  const activeMeta = AGENT_META[activeAgent] || { label: activeAgent, icon: '🤖' };

  const panel = (
      <motion.div
        key="panel"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ duration: 0.15 }}
        className={clsx(
          'fixed z-50 flex h-[32rem] w-96 max-w-[calc(100vw-3rem)] flex-col',
          // Anchored under the header (not bottom-right) so a Chief Agent
          // instance mounted there never overlaps a page-specific widget's
          // own bottom-right panel — the two can be open at once.
          isHeader ? 'right-4 top-16' : 'bottom-24 right-6',
          'overflow-hidden rounded-xl border border-hairline bg-panel/95 shadow-panel backdrop-blur-2xl'
        )}
      >
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <span aria-hidden="true">{activeMeta.icon}</span>
            {activeMeta.label}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleClearChat}
              disabled={messages.length === 0}
              className="text-xs text-ink-faint hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear chat
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="text-ink-faint hover:text-ink"
            >
              ✕
            </button>
          </div>
        </div>

        {showTabs ? (
          <div className="flex gap-1 border-b border-hairline px-3 py-2">
            {agents.map((agentName) => {
              const meta = AGENT_META[agentName] || { label: agentName, icon: '🤖' };
              return (
                <button
                  key={agentName}
                  type="button"
                  onClick={() => setActiveAgent(agentName)}
                  className={clsx(
                    'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                    agentName === activeAgent
                      ? 'bg-accent/15 text-accent-bright'
                      : 'text-ink-faint hover:bg-panel-sunken hover:text-ink'
                  )}
                >
                  {meta.icon} {meta.label}
                </button>
              );
            })}
          </div>
        ) : null}

        <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
          {messages.length === 0 ? (
            <p className="text-xs text-ink-faint">
              {historyLoading
                ? 'Loading previous conversation…'
                : `Ask ${activeMeta.label} to change platform behaviour — every change is proposed first, and nothing applies until you click Apply.`}
            </p>
          ) : null}

          {messages.map((message) => (
            <div key={message.id} className={message.role === 'user' ? 'text-right' : 'text-left'}>
              <div
                className={clsx(
                  'inline-block max-w-[85%] rounded-lg px-3 py-2 text-left',
                  message.role === 'user' ? 'bg-accent/20 text-ink' : 'bg-panel-sunken text-ink'
                )}
              >
                {message.role === 'user' ? message.text : <MarkdownMessage text={message.text} />}
              </div>
              {message.role === 'assistant' ? <TurnSteps steps={message.steps} /> : null}
              {message.role === 'assistant' ? <KnowledgeUsageNote usage={message.knowledgeUsage} /> : null}
              {(message.proposedChanges || []).map((change, changeIndex) => {
                const statusKey = `${message.id}:${changeIndex}`;
                return (
                  <ProposedChangeCard
                    key={statusKey}
                    change={change}
                    status={changeStatus[statusKey]}
                    onApply={() => handleApply(message.id, changeIndex, change)}
                    onDismiss={() => handleDismiss(message.id, changeIndex, change)}
                    onRevert={() => handleRevert(message.id, changeIndex, change)}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {sending ? (
          <div className="flex items-center gap-2 border-t border-hairline bg-panel-sunken/50 px-4 py-2 text-xs text-ink-faint">
            <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            <span className="truncate">{statusText || 'Thinking...'}</span>
          </div>
        ) : null}

        <ErrorBanner error={error} onDismiss={() => setError(null)} className="mx-3 mb-2" />

        <form onSubmit={handleSend} className="flex items-end gap-2 border-t border-hairline p-3">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) handleSend(e);
            }}
            rows={2}
            placeholder={historyLoading ? 'Loading previous conversation…' : `Message ${activeMeta.label}...`}
            containerClassName="flex-1"
            className="resize-none text-sm"
            disabled={sending || historyLoading}
          />
          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={sending}
            disabled={!input.trim() || historyLoading}
          >
            Send
          </Button>
        </form>
      </motion.div>
  );

  return (
    <>
      {isHeader ? (
        // Inline header button, not fixed-positioned — meant to sit next to
        // ThemeToggle in AppLayout.js, always reachable regardless of page.
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close Chief Agent chat' : 'Ask the Chief Agent'}
          title="Ask the Chief Agent"
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-hairline bg-panel-raised p-2 text-xs text-ink-secondary transition-colors hover:bg-panel hover:text-ink"
        >
          <span aria-hidden="true">🧭</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close agent chat' : 'Open agent chat'}
          className={clsx(
            'fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full',
            'bg-accent text-white shadow-glow-sm transition-transform hover:-translate-y-0.5',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
          )}
        >
          <span aria-hidden="true" className="text-xl">
            {open ? '✕' : '💬'}
          </span>
        </button>
      )}

      <AnimatePresence>{open ? panel : null}</AnimatePresence>
    </>
  );
}
