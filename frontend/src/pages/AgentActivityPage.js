// frontend/src/pages/AgentActivityPage.js
/**
 * Agent Activity — the transparency page for the agentic-AI chat layer.
 *
 * Every step of every agent turn (user message, tool call, proposed/applied/
 * reverted setting, delegation, final reply) is logged to `agent_activity`
 * with a shared `trace_id` per conversation turn. This page groups rows by
 * trace and renders each as a small timeline, so "who changed what, and
 * which agent(s) were involved" is answerable without reading logs.
 *
 * Deliberately a dedicated page rather than a per-widget panel: the chat
 * widget only shows its OWN current trace inline, but this page is the one
 * place that spans every agent and every page that hosts a widget.
 */

import { useCallback, useEffect, useState } from 'react';

import { agentsApi } from '../lib/api';
import { AGENT_META, AGENT_ORDER } from '../lib/agentMeta';
import { Select } from '../components/ui/form';
import { Card, Badge, ErrorBanner, Skeleton, EmptyState } from '../components/ui/feedback';
import AgentCommunicationVisualizer from '../components/agents/AgentCommunicationVisualizer';

// Derived from the shared AGENT_META rather than hand-maintained here — this
// list used to be a local copy that only covered the first 3 agents ever
// built, silently missing every agent added since. Deriving it means it
// can't drift again.
const AGENT_OPTIONS = [
  { value: '', label: 'All agents' },
  ...AGENT_ORDER.map((name) => ({ value: name, label: AGENT_META[name].label })),
];

const AGENT_LABELS = Object.fromEntries(AGENT_ORDER.map((name) => [name, AGENT_META[name].label]));

const EVENT_TONE = {
  user_message: 'neutral',
  tool_call: 'accent',
  delegation: 'accent',
  setting_proposed: 'warning',
  setting_applied: 'good',
  setting_reverted: 'warning',
  error: 'critical',
  final_reply: 'neutral',
};

const EVENT_LABELS = {
  user_message: 'Message',
  tool_call: 'Tool call',
  delegation: 'Delegated',
  setting_proposed: 'Proposed',
  setting_applied: 'Applied',
  setting_reverted: 'Reverted',
  error: 'Error',
  final_reply: 'Reply',
};

/** Groups a flat, created_at-DESC list of rows into trace_id -> rows (chronological). */
function groupByTrace(rows) {
  const byTrace = new Map();
  for (const row of rows) {
    if (!byTrace.has(row.trace_id)) byTrace.set(row.trace_id, []);
    byTrace.get(row.trace_id).push(row);
  }
  // Rows arrived newest-first; each group should read oldest-first (a narrative).
  for (const group of byTrace.values()) group.reverse();
  return Array.from(byTrace.entries());
}

/** One-line summary of a row's payload, event-type aware. */
function summarize(row) {
  const payload = row.payload || {};
  switch (row.event_type) {
    case 'user_message':
      return payload.message;
    case 'tool_call':
      return row.tool_name;
    case 'delegation':
      return `${AGENT_LABELS[row.from_agent] || row.from_agent} → ${AGENT_LABELS[row.to_agent] || row.to_agent}: "${payload.instruction || ''}"`;
    case 'setting_proposed':
    case 'setting_applied':
    case 'setting_reverted': {
      const diff = payload.diff || {};
      const current = typeof diff.current_value === 'string' ? diff.current_value : JSON.stringify(diff.current_value ?? '');
      const proposed = typeof diff.proposed_value === 'string' ? diff.proposed_value : JSON.stringify(diff.proposed_value ?? '');
      return `${row.setting_key}${row.tool_name ? '' : ''} — "${current.slice(0, 60)}" → "${proposed.slice(0, 60)}"`;
    }
    case 'error':
      return payload.error_message;
    case 'final_reply':
      return payload.reply;
    default:
      return '';
  }
}

export default function AgentActivityPage() {
  const [agentName, setAgentName] = useState('');
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { limit: 200 };
      if (agentName) params.agent_name = agentName;
      const data = await agentsApi.listActivity(params);
      setRows(data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [agentName]);

  useEffect(() => {
    load();
  }, [load]);

  const traces = rows ? groupByTrace(rows) : [];

  return (
    <div className="space-y-8 animate-fade-in-up">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-ink">Agent Activity</h1>
          <p className="max-w-2xl text-base text-ink-secondary">
            Every step every agent has taken — what was said, which tools ran, what was proposed, and
            what a human actually applied or reverted. Grouped by conversation.
          </p>
        </div>
        <div className="w-full sm:w-64">
          <Select value={agentName} onChange={(e) => setAgentName(e.target.value)} options={AGENT_OPTIONS} />
        </div>
      </header>

      <AgentCommunicationVisualizer />

      {/* Reference strip — what each of the 8 agents actually does, sized to
          stay one row on a normal desktop width and wrap only on narrow
          viewports, same responsive pattern as the dashboard's stat tiles. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {AGENT_ORDER.map((name) => {
          const meta = AGENT_META[name];
          return (
            <Card key={name} interactive={false} className="p-3 text-center">
              <span aria-hidden="true" className="text-xl">
                {meta.icon}
              </span>
              <p className="mt-1.5 text-xs font-semibold leading-tight text-ink">{meta.label}</p>
              <p className="mt-1 text-[0.68rem] leading-snug text-ink-faint">{meta.description}</p>
            </Card>
          );
        })}
      </div>

      {error ? <ErrorBanner error={error} onRetry={load} /> : null}

      {loading && !rows ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-hairline bg-panel-raised/50 p-5">
              <Skeleton rows={3} />
            </div>
          ))}
        </div>
      ) : traces.length === 0 ? (
        <EmptyState
          icon={<span className="text-4xl text-accent">🧭</span>}
          title="No agent activity yet"
          message="Chat with an agent from the Wizard or Autopilot Mode page — every step will show up here."
        />
      ) : (
        <div className="space-y-4">
          {traces.map(([traceId, traceRows]) => (
            <div key={traceId} className="rounded-xl border border-hairline bg-panel-raised/50 p-5 shadow-panel">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {Array.from(new Set(traceRows.map((r) => r.agent_name))).map((name) => (
                    <Badge key={name} tone="accent">
                      {AGENT_LABELS[name] || name}
                    </Badge>
                  ))}
                </div>
                <span className="font-mono text-xs text-ink-faint" title={traceId}>
                  {traceId.slice(0, 8)}
                </span>
                <span className="text-xs text-ink-faint">
                  {new Date(traceRows[0].created_at).toLocaleString()}
                </span>
              </div>

              <ol className="space-y-2 border-l border-hairline pl-4">
                {traceRows.map((row) => (
                  <li key={row.id} className="relative text-sm">
                    <span className="absolute -left-[1.1rem] top-1.5 h-2 w-2 rounded-full bg-accent/60" aria-hidden="true" />
                    <div className="flex flex-wrap items-baseline gap-2">
                      <Badge tone={EVENT_TONE[row.event_type] || 'neutral'}>
                        {EVENT_LABELS[row.event_type] || row.event_type}
                      </Badge>
                      <span className="text-ink-faint">{AGENT_LABELS[row.agent_name] || row.agent_name}</span>
                      {row.status === 'failure' ? <Badge tone="critical">failed</Badge> : null}
                    </div>
                    <p className="mt-0.5 truncate text-ink-secondary">{summarize(row)}</p>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
