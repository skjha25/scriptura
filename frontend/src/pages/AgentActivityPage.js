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
import { Select, Input, Textarea } from '../components/ui/form';
import { Card, Badge, ErrorBanner, Skeleton, EmptyState } from '../components/ui/feedback';
import Button from '../components/ui/Button';
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

/** Small, best-effort human-readable summary of a recommendation's target_ref, whichever fields it has. */
function describeTargetRef(targetRef) {
  if (!targetRef || typeof targetRef !== 'object') return null;
  const parts = [];
  if (targetRef.blog_id) parts.push(`Blog #${targetRef.blog_id}`);
  if (targetRef.keyword) parts.push(`"${targetRef.keyword}"`);
  if (targetRef.page_url) parts.push(targetRef.page_url);
  return parts.length ? parts.join(' — ') : null;
}

/**
 * P1-B4: `result_summary.before`/`after` from actionExecutors.js come in two
 * shapes — keyed by field name (blog.update_seo_fields: `{meta_title: ...}`)
 * or a single whole value (blog.update_block: the block's raw `data`
 * object, not keyed by 'content_blocks'). Falls back to the whole object
 * when the field isn't a key on it, so both render correctly.
 */
function pickResultValue(obj, field) {
  if (obj && typeof obj === 'object' && field in obj) return obj[field];
  return obj;
}

function formatResultValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.join(', ') || '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * P1-A: recommendation approval/rejection — completely separate from the
 * proposed_change Apply flow (ProposedChangeCard/handleApply/resolveApplyStrategy
 * in AgentChatWidget.js). These rows are `type:'recommendation'` results,
 * which never enter `proposedChanges` and are never rendered by that
 * component — see services/agents/runAgentTurn.js's own comment on that
 * branch. There is deliberately no Apply button here: approving only
 * records a human decision (agent_recommendations.decided_by/decided_at);
 * nothing is executed. Action tracking is explicitly P1-B, not built yet —
 * hence the static "Action: Not implemented yet" line after approval.
 */
function PendingRecommendations() {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [decidingId, setDecidingId] = useState(null);
  // Per-row override so an approved/rejected row keeps showing its decided
  // state immediately (rather than just vanishing) until the next manual
  // refresh — the underlying decision itself is already durable server-side
  // the moment the API call succeeds; this is purely in-session UI feedback.
  const [decisionOverride, setDecisionOverride] = useState({});

  // Bulk approve/reject: a lightweight inline confirm rather than a native
  // confirm() dialog, matching this app's own UI conventions. `null` means no
  // confirm is showing; 'approve'|'reject' is the action awaiting confirmation.
  const [confirmingBulk, setConfirmingBulk] = useState(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await agentsApi.listRecommendations({ status: 'recommended' });
      setRows(data);
      setDecisionOverride({});
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const decide = useCallback(async (id, action) => {
    setDecidingId(id);
    try {
      const updated =
        action === 'approve' ? await agentsApi.approveRecommendation(id) : await agentsApi.rejectRecommendation(id);
      setDecisionOverride((prev) => ({ ...prev, [id]: updated.status }));
    } catch (err) {
      setError(err);
    } finally {
      setDecidingId(null);
    }
  }, []);

  /**
   * Acts on every currently-`recommended` row server-side (not just the
   * loaded page) — see recommendationDecisions.js's bulkDecideRecommendations.
   * Because this changes each row's status in the database itself, a
   * rejected/approved row is genuinely gone from the 'recommended' view on
   * the next `load()` (here, and on a full page refresh) — not just hidden
   * client-side.
   */
  const decideAll = useCallback(
    async (action) => {
      setBulkRunning(true);
      setError(null);
      try {
        if (action === 'approve') await agentsApi.bulkApproveRecommendations();
        else await agentsApi.bulkRejectRecommendations();
        setConfirmingBulk(null);
        await load();
      } catch (err) {
        setError(err);
      } finally {
        setBulkRunning(false);
      }
    },
    [load]
  );

  if (loading && !rows) {
    return (
      <Card interactive={false} className="p-5">
        <Skeleton rows={3} />
      </Card>
    );
  }

  if (error) return <ErrorBanner error={error} onRetry={load} />;
  if (!rows || rows.length === 0) return null; // nothing pending — stay out of the way rather than showing an empty section

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">Pending Recommendations</h2>
        {confirmingBulk ? (
          <div className="flex items-center gap-2 text-xs text-ink-secondary">
            <span>
              {confirmingBulk === 'approve' ? 'Approve' : 'Reject'} all pending recommendations?
            </span>
            <Button
              type="button"
              variant={confirmingBulk === 'approve' ? 'primary' : 'danger'}
              size="sm"
              loading={bulkRunning}
              onClick={() => decideAll(confirmingBulk)}
            >
              Confirm
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={bulkRunning}
              onClick={() => setConfirmingBulk(null)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmingBulk('approve')}>
              Approve all
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmingBulk('reject')}>
              Reject all
            </Button>
          </div>
        )}
      </div>
      <div className="space-y-3">
        {rows.map((row) => {
          const status = decisionOverride[row.id] || row.status;
          const target = describeTargetRef(row.target_ref);
          return (
            <Card key={row.id} interactive={false} className="p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                <Badge tone="accent">{AGENT_LABELS[row.agent_name] || row.agent_name}</Badge>
                {target ? <span>{target}</span> : null}
                {typeof row.confidence === 'number' ? <span>Confidence: {Math.round(row.confidence * 100)}%</span> : null}
                <span>{new Date(row.created_at).toLocaleString()}</span>
              </div>
              <p className="mt-2 text-sm text-ink">{row.recommendation_details?.recommendation || row.summary}</p>
              {row.recommendation_details?.rationale ? (
                <p className="mt-1 text-xs text-ink-secondary">{row.recommendation_details.rationale}</p>
              ) : null}

              <div className="mt-3">
                {status === 'approved' ? (
                  <div className="flex items-center gap-2 text-xs">
                    <Badge tone="good">Approved</Badge>
                    <span className="text-ink-faint">Action: Not implemented yet</span>
                  </div>
                ) : status === 'rejected' ? (
                  <Badge tone="neutral">Rejected</Badge>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      loading={decidingId === row.id}
                      onClick={() => decide(row.id, 'approve')}
                    >
                      Approve
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={decidingId === row.id}
                      onClick={() => decide(row.id, 'reject')}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

/**
 * P1-B: recommendation action tracking — completely separate from the
 * proposed_change Apply flow, same as PendingRecommendations above. An
 * action is never auto-created by approval (see
 * services/agents/recommendationActions.js's header comment) — this section
 * exists specifically so an already-approved recommendation doesn't just
 * disappear with no way to track whether anyone acted on it (P1-A's list
 * only ever showed status:'recommended' rows). Never shows "Completed"
 * language unless a real `completed` action row exists.
 */
/**
 * P2-D: read-only outcome data (baseline/fresh evidence, metric_deltas,
 * classification) for one completed action, if any was ever captured. Only
 * ever rendered inside the existing `latest.status === 'completed'` branch
 * below — an outcome can't exist for a pending/failed/cancelled action, so
 * this never has to reconcile with those states. No Apply button, no
 * editable field anywhere here — nothing in this component can write back
 * to the outcome; there is no mutation endpoint for it at all.
 */
const OUTCOME_TONE = { improved: 'good', declined: 'critical', neutral: 'accent', inconclusive: 'warning' };
const OUTCOME_STATUS_TONE = { pending: 'warning', evaluated: 'good', inconclusive: 'accent' };

function OutcomePanel({ outcome }) {
  if (outcome === undefined) return null; // still loading — the surrounding action state already renders
  if (outcome === null) {
    return (
      <p className="mt-1.5 text-ink-faint">
        No measurable outcome yet — nothing was metric-observable for this action, or the observation window hasn&apos;t elapsed.
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-hairline bg-panel-raised/40 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={OUTCOME_STATUS_TONE[outcome.status] || 'accent'}>Outcome: {outcome.status}</Badge>
        {outcome.outcome ? <Badge tone={OUTCOME_TONE[outcome.outcome] || 'accent'}>{outcome.outcome}</Badge> : null}
        <span className="text-ink-faint">
          baseline {new Date(outcome.baseline_at).toLocaleDateString()} · window {outcome.observation_window_days}d ·
          due {new Date(outcome.due_at).toLocaleDateString()}
          {outcome.evaluation_attempts > 0 ? ` · attempts ${outcome.evaluation_attempts}` : ''}
        </span>
      </div>

      {outcome.baseline_metric_snapshot?.length ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-ink-secondary">
          {outcome.baseline_metric_snapshot.map((m) => {
            const delta = outcome.metric_deltas?.find((d) => d.metric === m.metric);
            return (
              <span key={m.metric}>
                <span className="font-medium">{m.metric}:</span> {m.value}
                {delta ? (
                  <>
                    {' → '}
                    {delta.fresh}
                    {' ('}
                    <span
                      className={
                        delta.delta > 0 ? 'text-status-good' : delta.delta < 0 ? 'text-status-critical' : 'text-ink-faint'
                      }
                    >
                      {delta.delta > 0 ? '+' : ''}
                      {delta.delta}
                    </span>
                    {')'}
                  </>
                ) : null}
              </span>
            );
          })}
        </div>
      ) : null}

      {outcome.outcome_reasoning ? <p className="italic text-ink-faint">{outcome.outcome_reasoning}</p> : null}
    </div>
  );
}

function ApprovedAwaitingAction() {
  const [rows, setRows] = useState(null);
  const [actionsByRecommendation, setActionsByRecommendation] = useState({});
  const [outcomesByAction, setOutcomesByAction] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [actionTypeDraft, setActionTypeDraft] = useState({});
  const [parametersDraft, setParametersDraft] = useState({});
  const [noteDraft, setNoteDraft] = useState({});

  /** Fetches the outcome for a completed action only — an outcome can never exist for any other status. */
  const loadOutcomeFor = useCallback(async (actionsForRec) => {
    const latest = actionsForRec[0];
    if (!latest || latest.status !== 'completed') return null;
    const outcome = await agentsApi.getRecommendationActionOutcome(latest.id);
    return [latest.id, outcome];
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const recs = await agentsApi.listRecommendations({ status: 'approved' });
      setRows(recs);
      const entries = await Promise.all(
        recs.map(async (rec) => [rec.id, await agentsApi.listRecommendationActions(rec.id)])
      );
      const actionsMap = Object.fromEntries(entries);
      setActionsByRecommendation(actionsMap);

      const outcomeEntries = await Promise.all(Object.values(actionsMap).map(loadOutcomeFor));
      setOutcomesByAction(Object.fromEntries(outcomeEntries.filter(Boolean)));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [loadOutcomeFor]);

  useEffect(() => {
    load();
  }, [load]);

  const refreshOne = useCallback(
    async (recId) => {
      const actions = await agentsApi.listRecommendationActions(recId);
      setActionsByRecommendation((prev) => ({ ...prev, [recId]: actions }));
      const entry = await loadOutcomeFor(actions);
      if (entry) setOutcomesByAction((prev) => ({ ...prev, [entry[0]]: entry[1] }));
    },
    [loadOutcomeFor]
  );

  const startAction = useCallback(
    async (recId) => {
      setBusyId(recId);
      try {
        const actionType = (actionTypeDraft[recId] || '').trim();
        if (!actionType) return;
        const rawParameters = (parametersDraft[recId] || '').trim();
        let parameters;
        if (rawParameters) {
          try {
            parameters = JSON.parse(rawParameters);
          } catch {
            setError(new Error('Parameters must be valid JSON, e.g. {"blog_id": 42, "meta_title": "New title"}.'));
            return;
          }
        }
        await agentsApi.createRecommendationAction(recId, { action_type: actionType, parameters });
        await refreshOne(recId);
      } catch (err) {
        setError(err);
      } finally {
        setBusyId(null);
      }
    },
    [actionTypeDraft, parametersDraft, refreshOne]
  );

  const retryAction = useCallback(
    async (recId, previousActionType) => {
      setBusyId(recId);
      try {
        await agentsApi.createRecommendationAction(recId, { action_type: previousActionType });
        await refreshOne(recId);
      } catch (err) {
        setError(err);
      } finally {
        setBusyId(null);
      }
    },
    [refreshOne]
  );

  const disposeAction = useCallback(
    async (recId, actionId, disposition) => {
      setBusyId(recId);
      try {
        const note = (noteDraft[actionId] || '').trim();
        if (disposition === 'complete') {
          await agentsApi.completeRecommendationAction(actionId, note ? { result_summary: { note } } : {});
        } else if (disposition === 'fail') {
          await agentsApi.failRecommendationAction(actionId, note ? { error: note } : {});
        } else {
          await agentsApi.cancelRecommendationAction(actionId);
        }
        await refreshOne(recId);
      } catch (err) {
        setError(err);
      } finally {
        setBusyId(null);
      }
    },
    [noteDraft, refreshOne]
  );

  const executeAction = useCallback(
    async (recId, actionId) => {
      setBusyId(recId);
      try {
        await agentsApi.executeRecommendationAction(actionId);
        await refreshOne(recId);
      } catch (err) {
        setError(err);
      } finally {
        setBusyId(null);
      }
    },
    [refreshOne]
  );

  if (loading && !rows) {
    return (
      <Card interactive={false} className="p-5">
        <Skeleton rows={3} />
      </Card>
    );
  }

  if (error) return <ErrorBanner error={error} onRetry={load} />;
  if (!rows || rows.length === 0) return null; // nothing approved — stay out of the way

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-ink">Approved — Awaiting Action</h2>
      <div className="space-y-3">
        {rows.map((row) => {
          const history = actionsByRecommendation[row.id] || [];
          const latest = history[0] || null;
          const target = describeTargetRef(row.target_ref);
          const busy = busyId === row.id;

          return (
            <Card key={row.id} interactive={false} className="p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                <Badge tone="accent">{AGENT_LABELS[row.agent_name] || row.agent_name}</Badge>
                {target ? <span>{target}</span> : null}
                <span>{new Date(row.created_at).toLocaleString()}</span>
              </div>
              <p className="mt-2 text-sm text-ink">{row.recommendation_details?.recommendation || row.summary}</p>

              <div className="mt-3">
                {!latest || latest.status === 'cancelled' ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={actionTypeDraft[row.id] || ''}
                        onChange={(e) => setActionTypeDraft((prev) => ({ ...prev, [row.id]: e.target.value }))}
                        placeholder="e.g. blog.update_seo_fields"
                        className="max-w-xs"
                      />
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        loading={busy}
                        disabled={!(actionTypeDraft[row.id] || '').trim()}
                        onClick={() => startAction(row.id)}
                      >
                        Start Action
                      </Button>
                    </div>
                    <Textarea
                      value={parametersDraft[row.id] || ''}
                      onChange={(e) => setParametersDraft((prev) => ({ ...prev, [row.id]: e.target.value }))}
                      placeholder='Optional parameters JSON, e.g. {"blog_id": 42, "meta_title": "New title"} — required for blog.* action types'
                      rows={2}
                      className="max-w-xl font-mono text-xs"
                    />
                  </div>
                ) : latest.status === 'pending' ? (
                  <div className="space-y-2">
                    <Badge tone="warning">
                      Action: Pending ({latest.action_type}
                      {latest.executor_type === 'automated' ? ', automated' : ''})
                    </Badge>
                    {latest.executor_type === 'automated' ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" variant="success" size="sm" loading={busy} onClick={() => executeAction(row.id, latest.id)}>
                          Execute
                        </Button>
                        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => disposeAction(row.id, latest.id, 'cancel')}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          value={noteDraft[latest.id] || ''}
                          onChange={(e) => setNoteDraft((prev) => ({ ...prev, [latest.id]: e.target.value }))}
                          placeholder="Optional note"
                          className="max-w-xs"
                        />
                        <Button type="button" variant="success" size="sm" loading={busy} onClick={() => disposeAction(row.id, latest.id, 'complete')}>
                          Mark Completed
                        </Button>
                        <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => disposeAction(row.id, latest.id, 'fail')}>
                          Mark Failed
                        </Button>
                        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => disposeAction(row.id, latest.id, 'cancel')}>
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                ) : latest.status === 'completed' ? (
                  <div className="space-y-1.5 text-xs">
                    <Badge tone="good">Action: Completed</Badge>
                    {latest.result_summary?.note ? <p className="text-ink-faint">{latest.result_summary.note}</p> : null}
                    {latest.result_summary?.mutated_fields ? (
                      <div className="space-y-1 rounded-lg border border-hairline bg-panel-raised/50 p-2">
                        {latest.result_summary.mutated_fields.map((field) => (
                          <div key={field} className="flex flex-wrap items-start gap-1.5">
                            <span className="font-medium text-ink-secondary">{field}:</span>
                            <span className="text-status-critical line-through">
                              {formatResultValue(pickResultValue(latest.result_summary.before, field))}
                            </span>
                            <span className="text-ink-faint">→</span>
                            <span className="text-status-good">
                              {formatResultValue(pickResultValue(latest.result_summary.after, field))}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <OutcomePanel outcome={outcomesByAction[latest.id]} />
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone="critical">Action: Failed</Badge>
                    {latest.error ? <span className="text-ink-faint">{latest.error}</span> : null}
                    <Button type="button" variant="secondary" size="sm" loading={busy} onClick={() => retryAction(row.id, latest.action_type)}>
                      Retry
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
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
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Agent Activity</h1>
          <p className="max-w-2xl text-base text-ink-secondary">
            Every step every agent has taken — what was said, which tools ran, what was proposed, and
            what a human actually applied or reverted. Grouped by conversation.
          </p>
        </div>
        <div className="w-full sm:w-64">
          <Select value={agentName} onChange={(e) => setAgentName(e.target.value)} options={AGENT_OPTIONS} />
        </div>
      </header>

      <PendingRecommendations />

      <ApprovedAwaitingAction />

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
            <Card key={i} interactive={false} className="p-5">
              <Skeleton rows={3} />
            </Card>
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
            <Card key={traceId} interactive={false} className="p-5">
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
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
