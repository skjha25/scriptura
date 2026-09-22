/**
 * P2-D tests: AgentActivityPage's "Approved — Awaiting Action" outcome
 * rendering — the read-only OutcomePanel shown for completed actions.
 * `../../lib/api` is auto-mocked, same pattern as dashboard.test.js. Only
 * `agentsApi` is exercised here; `AgentCommunicationVisualizer` makes no
 * network calls of its own, so it needs no mocking.
 */

import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

import AgentActivityPage from '../AgentActivityPage';
import { agentsApi } from '../../lib/api';

jest.mock('../../lib/api');

const APPROVED_REC = {
  id: 7,
  agent_name: 'seo_analyst_agent',
  target_ref: { blog_id: 42 },
  recommendation_details: { recommendation: 'Update meta_title on Blog #42.' },
  summary: null,
  created_at: '2026-08-01T00:00:00.000Z',
};

const COMPLETED_ACTION = {
  id: 5,
  status: 'completed',
  action_type: 'blog.update_seo_fields',
  executor_type: 'automated',
  result_summary: { before: { meta_title: 'Old' }, after: { meta_title: 'New' }, mutated_fields: ['meta_title'] },
};

const PENDING_ACTION = { id: 6, status: 'pending', action_type: 'blog.update_seo_fields', executor_type: 'automated' };

const REAL_OUTCOME = {
  id: 1,
  recommendation_id: 7,
  action_id: 5,
  status: 'evaluated',
  outcome: 'improved',
  baseline_at: '2026-08-01T00:00:00.000Z',
  due_at: '2026-08-15T00:00:00.000Z',
  baseline_evidence_refs: [{ type: 'blog', id: 42 }],
  baseline_metric_snapshot: [{ metric: 'seo_score', value: 27 }],
  fresh_evidence_refs: [{ type: 'blog', id: 42 }],
  metric_deltas: [{ metric: 'seo_score', baseline: 27, fresh: 40, delta: 13 }],
  observation_window_days: 14,
  evaluation_attempts: 1,
  outcome_reasoning: 'SEO score rose after the metadata update.',
  evaluated_at: '2026-08-15T01:00:00.000Z',
};

/** Only PendingRecommendations/ApprovedAwaitingAction differ by `status`; every other agentsApi call used by the page gets a safe default here. */
function setupApi({ approvedRecs = [], actionsByRec = {}, outcomeByAction = {} } = {}) {
  agentsApi.listActivity.mockResolvedValue([]);
  agentsApi.listRecommendations.mockImplementation(({ status } = {}) => {
    if (status === 'approved') return Promise.resolve(approvedRecs);
    return Promise.resolve([]); // 'recommended' (PendingRecommendations) — empty, out of scope for these tests
  });
  agentsApi.listRecommendationActions.mockImplementation((recId) => Promise.resolve(actionsByRec[recId] || []));
  agentsApi.getRecommendationActionOutcome.mockImplementation((actionId) =>
    Promise.resolve(Object.prototype.hasOwnProperty.call(outcomeByAction, actionId) ? outcomeByAction[actionId] : null)
  );
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AgentActivityPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Approved — Awaiting Action: loading/error/empty states', () => {
  it('shows nothing (no heading) when there are no approved recommendations', async () => {
    setupApi({ approvedRecs: [] });
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Agent Activity' });
    expect(screen.queryByText('Approved — Awaiting Action')).toBeNull();
  });

  it('shows a retryable error banner when the approved-recommendations request fails', async () => {
    agentsApi.listActivity.mockResolvedValue([]);
    agentsApi.listRecommendations.mockImplementation(({ status } = {}) => {
      if (status === 'approved') return Promise.reject({ message: 'Cannot reach the server.' });
      return Promise.resolve([]);
    });
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Cannot reach the server.');
  });
});

describe('Approved — Awaiting Action: outcome rendering on a completed action', () => {
  it('renders the full deterministic outcome — status, classification, metrics, deltas, reasoning', async () => {
    setupApi({
      approvedRecs: [APPROVED_REC],
      actionsByRec: { 7: [COMPLETED_ACTION] },
      outcomeByAction: { 5: REAL_OUTCOME },
    });
    renderPage();

    await screen.findByText('Approved — Awaiting Action');
    expect(screen.getByText('Action: Completed')).toBeInTheDocument();

    expect(screen.getByText(/Outcome: evaluated/)).toBeInTheDocument();
    expect(screen.getByText('improved')).toBeInTheDocument();
    expect(screen.getByText(/seo_score:/)).toBeInTheDocument();
    expect(screen.getByText(/\+13/)).toBeInTheDocument(); // the delta, signed
    expect(screen.getByText('SEO score rose after the metadata update.')).toBeInTheDocument();
  });

  it('shows an explicit "no outcome yet" note — never a fabricated/empty outcome block — when none was captured', async () => {
    setupApi({
      approvedRecs: [APPROVED_REC],
      actionsByRec: { 7: [COMPLETED_ACTION] },
      outcomeByAction: {}, // getRecommendationActionOutcome resolves null
    });
    renderPage();

    await screen.findByText('Action: Completed');
    expect(
      screen.getByText(/No measurable outcome yet/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Outcome: evaluated/)).toBeNull();
  });

  it('never renders any Apply/Edit control for outcome data — read-only by construction', async () => {
    setupApi({
      approvedRecs: [APPROVED_REC],
      actionsByRec: { 7: [COMPLETED_ACTION] },
      outcomeByAction: { 5: REAL_OUTCOME },
    });
    renderPage();

    await screen.findByText(/Outcome: evaluated/);
    expect(screen.queryByRole('button', { name: /apply/i })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull(); // no editable field anywhere in the completed/outcome section
  });
});

describe('Approved — Awaiting Action: existing flow untouched', () => {
  it('a pending automated action still shows Execute, with no outcome section at all (outcomes only exist for completed actions)', async () => {
    setupApi({
      approvedRecs: [APPROVED_REC],
      actionsByRec: { 7: [PENDING_ACTION] },
    });
    renderPage();

    await screen.findByText(/Action: Pending/);
    expect(screen.getByRole('button', { name: 'Execute' })).toBeInTheDocument();
    expect(screen.queryByText(/Outcome:/)).toBeNull();
    expect(agentsApi.getRecommendationActionOutcome).not.toHaveBeenCalled();
  });

  it('a recommendation with no action yet still shows the Start Action form, unaffected by P2-D', async () => {
    setupApi({ approvedRecs: [APPROVED_REC], actionsByRec: { 7: [] } });
    renderPage();

    await screen.findByText('Approved — Awaiting Action');
    expect(screen.getByRole('button', { name: 'Start Action' })).toBeInTheDocument();
  });
});
