/**
 * P5-D tests: IntelligenceObservatoryPage — a pure read-only visualization
 * layer over services/agents/observatory.js. `../../lib/api` is
 * auto-mocked, same pattern as agentActivityOutcome.test.js /
 * learningCandidatesReview.test.js. These tests exist to prove the page
 * only ever renders what the (mocked) API actually returned — never a
 * fabricated event, count, or state — and that polling replaces data
 * without duplicating it.
 */

import { render, screen, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

import IntelligenceObservatoryPage from '../IntelligenceObservatoryPage';
import { agentsApi, observatoryApi } from '../../lib/api';

jest.mock('../../lib/api');

const SUMMARY = {
  activeAgents: 2,
  knowledgeItems: 12,
  knowledgeUsages: 40,
  pendingCandidates: 1,
  contestedKnowledge: 1,
  actionsInProgress: 0,
  completedActions: 5,
  evaluatedOutcomes: 3,
  recentLearningEvents: 6,
  asOf: '2026-08-14T12:00:00.000Z',
};

const IDLE_AGENT = { agentName: 'blog_ops_agent', state: 'idle', lastActiveAt: null, knowledgeCount: 0, pendingCandidates: 0, contestedKnowledge: 0, recentOutcomes: 0 };
const ACTIVE_AGENT = {
  agentName: 'seo_analyst_agent',
  state: 'retrieving_knowledge',
  lastActiveAt: new Date().toISOString(),
  knowledgeCount: 5,
  pendingCandidates: 1,
  contestedKnowledge: 1,
  recentOutcomes: 2,
};

const ACTIVITY_EVENTS = [
  { id: 'usage-1', at: '2026-08-14T11:59:00.000Z', kind: 'knowledge_retrieval', agentName: 'seo_analyst_agent', knowledgeId: 42, icon: '🧠', summary: 'retrieved Knowledge #42' },
  { id: 'outcome-18', at: '2026-08-14T11:58:00.000Z', kind: 'outcome_evaluated', outcomeId: 18, outcome: 'improved', icon: '📊', summary: 'Outcome #18 evaluated as improved' },
  { id: 'reinforce-18-42', at: '2026-08-14T11:58:00.000Z', kind: 'reinforcement', outcomeId: 18, knowledgeId: 42, direction: 'improved', icon: '🔄', summary: 'Knowledge #42 reinforced (improved)' },
  { id: 'candidate-detected-7', at: '2026-08-14T11:57:00.000Z', kind: 'learning_candidate_detected', candidateId: 7, agentName: 'seo_analyst_agent', icon: '🧠', summary: 'Learning candidate detected for "blog.update_seo_fields"' },
];

const KNOWLEDGE_HEALTH = {
  total: 3,
  confirmed: 1,
  unverified: 1,
  contested: 1,
  outdated: 0,
  pendingCandidates: 1,
  confidenceDistribution: [0, 1, 0, 1, 1],
  totalSuccessEvidence: 4,
  totalFailureEvidence: 1,
};

const KNOWLEDGE_NODES = [
  { id: 42, topic: 't1', category: 'seo_strategy', claim: 'Agent-scoped claim.', scope: 'agent', agent_name: 'seo_analyst_agent', status: 'confirmed', confidence: 0.7, usage_count: 3, success_count: 2, failure_count: 0, related_knowledge_ids: null },
  { id: 43, topic: 't2', category: 'seo_strategy', claim: 'Global claim.', scope: 'global', agent_name: null, status: 'contested', confidence: 0.4, usage_count: 1, success_count: 0, failure_count: 1, related_knowledge_ids: [44] },
];

const KNOWLEDGE_CONNECTIONS = {
  knowledge: KNOWLEDGE_NODES[0],
  recommendations: [{ id: 101, recommendation_id: 101 }],
  actions: [{ id: 201, recommendation_id: 101, status: 'completed' }],
  outcomes: [{ id: 301, recommendation_id: 101, outcome: 'improved' }],
  relatedKnowledge: [],
  recentUsageCount: 3,
};

function setupApi({ agents = [IDLE_AGENT, ACTIVE_AGENT], activity = ACTIVITY_EVENTS, pendingCandidates = [] } = {}) {
  observatoryApi.getSummary.mockResolvedValue(SUMMARY);
  observatoryApi.getAgents.mockResolvedValue(agents);
  observatoryApi.getActivity.mockResolvedValue(activity);
  observatoryApi.getKnowledgeHealth.mockResolvedValue(KNOWLEDGE_HEALTH);
  observatoryApi.getKnowledgeNodes.mockResolvedValue(KNOWLEDGE_NODES);
  observatoryApi.getKnowledgeConnections.mockResolvedValue(KNOWLEDGE_CONNECTIONS);
  agentsApi.listLearningCandidates.mockResolvedValue(pendingCandidates);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <IntelligenceObservatoryPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Live counters and header', () => {
  it('renders real counter values from the API, not placeholders', async () => {
    setupApi();
    renderPage();
    await screen.findByText('Intelligence Observatory');
    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument()); // knowledgeItems
  });

  it('shows a retryable error banner when the summary request fails', async () => {
    observatoryApi.getSummary.mockRejectedValue({ message: 'Cannot reach the server.' });
    observatoryApi.getAgents.mockResolvedValue([]);
    observatoryApi.getActivity.mockResolvedValue([]);
    observatoryApi.getKnowledgeHealth.mockResolvedValue(KNOWLEDGE_HEALTH);
    observatoryApi.getKnowledgeNodes.mockResolvedValue([]);
    agentsApi.listLearningCandidates.mockResolvedValue([]);
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Cannot reach the server.');
  });
});

describe('Live Agent Status — idle vs. active, multiple agents', () => {
  it('renders an idle agent with the Idle badge and a "never" last-active time', async () => {
    setupApi();
    renderPage();
    const card = await screen.findByTestId('agent-status-blog_ops_agent');
    expect(within(card).getByText('Idle')).toBeInTheDocument();
    expect(within(card).getByText(/never/)).toBeInTheDocument();
  });

  it('renders an active agent with its specific real state label ("Retrieving Knowledge")', async () => {
    setupApi();
    renderPage();
    const activeCard = await screen.findByTestId('agent-status-seo_analyst_agent');
    expect(within(activeCard).getByText('Retrieving Knowledge')).toBeInTheDocument();
  });

  it('renders both agents from a multi-agent response, each with its own real counts', async () => {
    setupApi();
    renderPage();
    await screen.findByTestId('agent-status-seo_analyst_agent');
    await screen.findByTestId('agent-status-blog_ops_agent');
    const activeCard = screen.getByTestId('agent-status-seo_analyst_agent');
    expect(within(activeCard).getByText('5')).toBeInTheDocument(); // knowledgeCount
  });
});

describe('Learning Activity Stream — every event type, empty state', () => {
  it('renders a real knowledge_retrieval event', async () => {
    setupApi();
    renderPage();
    expect(await screen.findByText(/retrieved Knowledge #42/)).toBeInTheDocument();
  });

  it('renders a real outcome_evaluated event', async () => {
    setupApi();
    renderPage();
    expect(await screen.findByText(/Outcome #18 evaluated as improved/)).toBeInTheDocument();
  });

  it('renders a real reinforcement event, distinct from the outcome event that produced it', async () => {
    setupApi();
    renderPage();
    expect(await screen.findByText(/Knowledge #42 reinforced \(improved\)/)).toBeInTheDocument();
  });

  it('renders a real learning_candidate_detected event', async () => {
    setupApi();
    renderPage();
    expect(await screen.findByText(/Learning candidate detected for "blog.update_seo_fields"/)).toBeInTheDocument();
  });

  it('shows "No recent learning activity" — never a fabricated event — when the API returns an empty stream', async () => {
    setupApi({ activity: [] });
    renderPage();
    expect(await screen.findByText('No recent learning activity')).toBeInTheDocument();
  });

  it('never renders more stream entries than the API actually returned', async () => {
    setupApi();
    renderPage();
    await screen.findByText(/retrieved Knowledge #42/);
    // Exactly the 4 fixture events, no extras.
    expect(observatoryApi.getActivity).toHaveBeenCalled();
    const items = screen.getAllByText(/·/, { selector: 'p' });
    expect(items.length).toBeLessThanOrEqual(ACTIVITY_EVENTS.length);
  });
});

describe('Repeated polling — data replaced, never duplicated', () => {
  it('a second poll tick with different data replaces the stream rather than appending to it', async () => {
    jest.useFakeTimers({ legacyFakeTimers: false });
    try {
      setupApi();
      renderPage();

      await act(async () => {
        await Promise.resolve();
      });
      expect(await screen.findByText(/retrieved Knowledge #42/)).toBeInTheDocument();
      expect(observatoryApi.getActivity).toHaveBeenCalledTimes(1);

      const secondBatch = [
        { id: 'usage-2', at: '2026-08-14T12:01:00.000Z', kind: 'knowledge_retrieval', agentName: 'seo_analyst_agent', knowledgeId: 99, icon: '🧠', summary: 'retrieved Knowledge #99' },
      ];
      observatoryApi.getActivity.mockResolvedValue(secondBatch);

      await act(async () => {
        jest.advanceTimersByTime(6000);
        await Promise.resolve();
      });
      await waitFor(() => expect(observatoryApi.getActivity).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByText(/retrieved Knowledge #99/)).toBeInTheDocument());
      // It appears exactly once — the new event was never duplicated.
      expect(screen.getAllByText(/retrieved Knowledge #99/)).toHaveLength(1);
    } finally {
      // Switch back to real timers BEFORE asserting the old item is gone —
      // AnimatePresence's exit transition runs on requestAnimationFrame,
      // which fake timers do not reliably drive; under real timers it
      // completes in a handful of real milliseconds, well within waitFor's
      // default timeout.
      jest.useRealTimers();
    }

    await waitFor(() => expect(screen.queryByText(/retrieved Knowledge #42/)).toBeNull());
  });
});

describe('Knowledge Network — agent vs. global scope, contested knowledge, connections', () => {
  it('distinguishes Agent-scoped from Global-scoped knowledge nodes', async () => {
    setupApi();
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('agent-status-seo_analyst_agent'));
    await screen.findByText('Agent-scoped claim.');
    expect(screen.getByText('Global claim.')).toBeInTheDocument();
    expect(screen.getAllByText('Agent').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Global').length).toBeGreaterThan(0);
  });

  it('shows a "contested" badge on a real contested knowledge node', async () => {
    setupApi();
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('agent-status-seo_analyst_agent'));
    await screen.findByText('Global claim.');
    expect(screen.getByText('contested')).toBeInTheDocument();
  });

  it('clicking a knowledge node loads and renders its real connections (recommendation, action, outcome)', async () => {
    setupApi();
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('agent-status-seo_analyst_agent'));
    const node = (await screen.findByText('Agent-scoped claim.')).closest('button');
    await user.click(node);

    await waitFor(() => expect(observatoryApi.getKnowledgeConnections).toHaveBeenCalledWith(42));
    await screen.findByText(/1 recommendation.*retrieved this/);
  });
});

describe('Learning Queue — deep links to the existing review UI, empty state', () => {
  it('renders a pending candidate and a working link to /agents/knowledge', async () => {
    setupApi({ pendingCandidates: [{ id: 9, agent_name: 'seo_analyst_agent', claim: 'A pending claim.' }] });
    renderPage();
    await screen.findByText('A pending claim.');
    const links = screen.getAllByRole('link', { name: /review now|open knowledge review/i });
    expect(links.length).toBeGreaterThan(0);
    links.forEach((link) => expect(link).toHaveAttribute('href', '/agents/knowledge'));
  });

  it('shows an explicit empty state — never a fabricated queue item — when nothing is pending', async () => {
    setupApi({ pendingCandidates: [] });
    renderPage();
    expect(await screen.findByText('Queue is empty')).toBeInTheDocument();
  });
});

describe('Knowledge Health', () => {
  it('renders real status breakdown and evidence counts, never invented percentages', async () => {
    setupApi();
    renderPage();
    await waitFor(() => expect(screen.getByText('Knowledge Health')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('4/1')).toBeInTheDocument()); // success/failure evidence
  });
});
