/**
 * P4-D tests: AgentKnowledgePage's "Learning Candidates" review section —
 * the human confirm/reject UI over the already-existing, unmodified P4
 * learningCandidateDecisions API. `../../lib/api` is auto-mocked, same
 * pattern as agentActivityOutcome.test.js. `knowledgeApi.get` is mocked to
 * an empty list by default — it's only exercised here for the Agent/Global
 * scope-resolution pass on already-confirmed rows; the rest of the page's
 * own "Current knowledge"/"Teach it something new" sections are unrelated
 * to this section and are left at their own defaults.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

import AgentKnowledgePage from '../AgentKnowledgePage';
import { agentsApi, knowledgeApi } from '../../lib/api';

jest.mock('../../lib/api');

const PENDING_CANDIDATE = {
  id: 7,
  pattern_key: 'action_type:seo_analyst_agent:blog.update_seo_fields',
  scope: 'agent',
  agent_name: 'seo_analyst_agent',
  category: 'outcome_pattern',
  topic: 'blog.update_seo_fields',
  claim: 'Across 5 observed outcomes, action type "blog.update_seo_fields" tended to improve the target metric in 80% of cases.',
  evidence: 'improved: 4, declined: 1, neutral: 0, inconclusive: 0 (sample_size: 5).',
  sample_size: 5,
  improved_count: 4,
  declined_count: 1,
  neutral_count: 0,
  inconclusive_count: 0,
  confidence: 0.8,
  evidence_refs: [
    { type: 'recommendation_outcome', id: 101 },
    { type: 'recommendation_outcome', id: 102 },
  ],
  status: 'pending_review',
  confirmed_knowledge_id: null,
  created_at: '2026-08-14T11:13:13.000Z',
};

function setupApi({ pending = [], confirmed = [], rejected = [] } = {}) {
  agentsApi.listLearningCandidates.mockImplementation(({ status } = {}) => {
    if (status === 'confirmed') return Promise.resolve(confirmed);
    if (status === 'rejected') return Promise.resolve(rejected);
    return Promise.resolve(pending);
  });
  knowledgeApi.get.mockResolvedValue([]);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AgentKnowledgePage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Learning Candidates — loading/empty/error states', () => {
  it('shows the empty state when there are no pending candidates', async () => {
    setupApi({ pending: [] });
    renderPage();

    await screen.findByText('No pending candidates');
    expect(agentsApi.listLearningCandidates).toHaveBeenCalledWith({ status: 'pending_review' });
  });

  it('shows a retryable error banner when the list request fails', async () => {
    agentsApi.listLearningCandidates.mockRejectedValue({ message: 'Cannot reach the server.' });
    knowledgeApi.get.mockResolvedValue([]);
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Cannot reach the server.');
  });

  it('shows a 403 error message from a non-admin session without crashing', async () => {
    agentsApi.listLearningCandidates.mockRejectedValue({ message: 'Admin access required.', status: 403, code: 'FORBIDDEN' });
    knowledgeApi.get.mockResolvedValue([]);
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Admin access required.');
  });
});

describe('Learning Candidates — pending candidate rendering (provenance)', () => {
  it('renders agent, category/topic, claim, evidence summary, counts, confidence, evidence refs, and detected time', async () => {
    setupApi({ pending: [PENDING_CANDIDATE] });
    renderPage();

    const card = await screen.findByTestId('learning-candidate-7');
    const scoped = within(card);

    expect(scoped.getByText(/SEO Analyst Agent/)).toBeInTheDocument();
    expect(scoped.getByText(/outcome_pattern/)).toBeInTheDocument();
    expect(scoped.getByText(PENDING_CANDIDATE.claim)).toBeInTheDocument();
    expect(scoped.getByText(PENDING_CANDIDATE.evidence)).toBeInTheDocument();
    // "Sample size: " and "Confidence: " each wrap their number in a nested
    // <strong>, so a plain getByText string match (which only matches an
    // element's own un-nested text) can't find them — match on the full
    // rendered textContent instead.
    expect(scoped.getByText((_, el) => el.tagName === 'SPAN' && el.textContent === 'Sample size: 5')).toBeInTheDocument();
    expect(scoped.getByText('Improved: 4')).toBeInTheDocument();
    expect(scoped.getByText('Declined: 1')).toBeInTheDocument();
    expect(scoped.getByText('Neutral: 0')).toBeInTheDocument();
    expect(scoped.getByText('Inconclusive: 0')).toBeInTheDocument();
    expect(scoped.getByText((_, el) => el.tagName === 'SPAN' && el.textContent === 'Confidence: 80%')).toBeInTheDocument();
    expect(scoped.getByText('Outcome #101')).toBeInTheDocument();
    expect(scoped.getByText('Outcome #102')).toBeInTheDocument();
    expect(scoped.getByTestId('pattern-key')).toHaveTextContent(PENDING_CANDIDATE.pattern_key);
    expect(scoped.getByText(/8\/14\/2026|14\/8\/2026/)).toBeInTheDocument(); // detected time, locale-formatted
  });

  it('shows all three human actions for a pending candidate', async () => {
    setupApi({ pending: [PENDING_CANDIDATE] });
    renderPage();

    const card = await screen.findByTestId('learning-candidate-7');
    expect(within(card).getByRole('button', { name: 'Confirm as Agent' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Confirm as Global' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });
});

describe('Learning Candidates — Confirm as Agent', () => {
  it('calls confirmLearningCandidate WITHOUT a scope argument, and shows "Confirmed — Agent" after', async () => {
    setupApi({ pending: [PENDING_CANDIDATE] });
    agentsApi.confirmLearningCandidate.mockResolvedValue({
      ...PENDING_CANDIDATE,
      status: 'confirmed',
      confirmed_knowledge_id: 99,
    });
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('learning-candidate-7');
    await user.click(within(card).getByRole('button', { name: 'Confirm as Agent' }));

    await waitFor(() => expect(agentsApi.confirmLearningCandidate).toHaveBeenCalledTimes(1));
    // The scope-selection safety requirement: an Agent confirm must never
    // send scope:'global' — the wrapper is called with `undefined` so the
    // body omits the key entirely and the backend default ('agent') wins.
    expect(agentsApi.confirmLearningCandidate).toHaveBeenCalledWith(7, undefined);
    const [, sentScope] = agentsApi.confirmLearningCandidate.mock.calls[0];
    expect(sentScope).not.toBe('global');

    await within(card).findByText('Confirmed — Agent');
    expect(within(card).queryByRole('button', { name: 'Confirm as Agent' })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Confirm as Global' })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Reject' })).toBeNull();
  });
});

describe('Learning Candidates — Confirm as Global', () => {
  it('calls confirmLearningCandidate WITH scope:"global" explicitly, and shows "Confirmed — Global" after', async () => {
    setupApi({ pending: [PENDING_CANDIDATE] });
    agentsApi.confirmLearningCandidate.mockResolvedValue({
      ...PENDING_CANDIDATE,
      status: 'confirmed',
      confirmed_knowledge_id: 100,
    });
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('learning-candidate-7');
    await user.click(within(card).getByRole('button', { name: 'Confirm as Global' }));

    await waitFor(() => expect(agentsApi.confirmLearningCandidate).toHaveBeenCalledTimes(1));
    expect(agentsApi.confirmLearningCandidate).toHaveBeenCalledWith(7, 'global');

    await within(card).findByText('Confirmed — Global');
  });
});

describe('Learning Candidates — Reject', () => {
  it('calls rejectLearningCandidate and shows the Rejected state after', async () => {
    setupApi({ pending: [PENDING_CANDIDATE] });
    agentsApi.rejectLearningCandidate.mockResolvedValue({ ...PENDING_CANDIDATE, status: 'rejected' });
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('learning-candidate-7');
    await user.click(within(card).getByRole('button', { name: 'Reject' }));

    await waitFor(() => expect(agentsApi.rejectLearningCandidate).toHaveBeenCalledWith(7));
    await within(card).findByText('Rejected');
    expect(within(card).queryByRole('button', { name: 'Reject' })).toBeNull();
  });
});

describe('Learning Candidates — the UI never writes agent_knowledge directly', () => {
  it('confirming only ever calls agentsApi.confirmLearningCandidate — knowledgeApi.confirm is never invoked from this section', async () => {
    setupApi({ pending: [PENDING_CANDIDATE] });
    agentsApi.confirmLearningCandidate.mockResolvedValue({ ...PENDING_CANDIDATE, status: 'confirmed', confirmed_knowledge_id: 99 });
    const { knowledgeApi: mockedKnowledgeApi } = require('../../lib/api');
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('learning-candidate-7');
    await user.click(within(card).getByRole('button', { name: 'Confirm as Agent' }));

    await waitFor(() => expect(agentsApi.confirmLearningCandidate).toHaveBeenCalledTimes(1));
    expect(mockedKnowledgeApi.confirm).not.toHaveBeenCalled();
  });

  it('rejecting never calls any knowledge-writing endpoint', async () => {
    setupApi({ pending: [PENDING_CANDIDATE] });
    agentsApi.rejectLearningCandidate.mockResolvedValue({ ...PENDING_CANDIDATE, status: 'rejected' });
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('learning-candidate-7');
    await user.click(within(card).getByRole('button', { name: 'Reject' }));

    await waitFor(() => expect(agentsApi.rejectLearningCandidate).toHaveBeenCalledTimes(1));
    expect(knowledgeApi.confirm).not.toHaveBeenCalled();
  });
});

describe('Learning Candidates — decision-call errors (duplicate/concurrent decisions)', () => {
  it('a 409 conflict from a duplicate/concurrent confirm shows an error banner and leaves the candidate actionable, not silently "succeeded"', async () => {
    setupApi({ pending: [PENDING_CANDIDATE] });
    agentsApi.confirmLearningCandidate.mockRejectedValue({
      message: 'Learning candidate #7 is already confirmed and cannot be confirmed.',
      status: 409,
      code: 'LEARNING_CANDIDATE_NOT_PENDING',
    });
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('learning-candidate-7');
    await user.click(within(card).getByRole('button', { name: 'Confirm as Agent' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('already confirmed');
    // The card itself is untouched by the failed call — still shows pending actions.
    expect(within(card).getByRole('button', { name: 'Confirm as Agent' })).toBeInTheDocument();
  });

  it('a 404 (candidate no longer exists) surfaces as a retryable error', async () => {
    setupApi({ pending: [PENDING_CANDIDATE] });
    agentsApi.rejectLearningCandidate.mockRejectedValue({ message: 'Learning candidate #7 not found.', status: 404, code: 'LEARNING_CANDIDATE_NOT_FOUND' });
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('learning-candidate-7');
    await user.click(within(card).getByRole('button', { name: 'Reject' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('not found');
  });
});

describe('Learning Candidates — status filter tabs', () => {
  it('switching to the Confirmed tab requests status:"confirmed" and resolves Agent/Global from the existing knowledge endpoint', async () => {
    const confirmedRow = { ...PENDING_CANDIDATE, id: 8, status: 'confirmed', confirmed_knowledge_id: 55 };
    setupApi({ pending: [PENDING_CANDIDATE], confirmed: [confirmedRow] });
    knowledgeApi.get.mockResolvedValue([{ id: 55, scope: 'global', claim: confirmedRow.claim }]);
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId('learning-candidate-7');
    await user.click(screen.getByRole('tab', { name: 'Confirmed' }));

    await waitFor(() => expect(agentsApi.listLearningCandidates).toHaveBeenCalledWith({ status: 'confirmed' }));
    const card = await screen.findByTestId('learning-candidate-8');
    await within(card).findByText('Confirmed — Global');
  });
});
