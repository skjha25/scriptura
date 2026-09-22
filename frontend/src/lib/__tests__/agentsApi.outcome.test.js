/**
 * Regression test for a real bug found in browser verification: P2-D's
 * `agentsApi.getRecommendationActionOutcome` was checking `err.response?.status`
 * to detect a 404 — but `api`'s response interceptor (src/lib/api.js) already
 * runs every rejection through `normalizeError()` before any `.catch()`
 * chained on the call site ever sees it, so by then `err` is
 * `{message, code, status, ...}`, never a raw axios error with `.response`.
 * The check silently never matched, and a completed action with no outcome
 * yet (a real, expected 404 OUTCOME_NOT_FOUND) re-threw as a generic error,
 * which AgentActivityPage.js's ApprovedAwaitingAction then rendered as a red
 * ErrorBanner instead of the intended "No measurable outcome yet" state.
 *
 * Same "replace the adapter, let interceptors run for real" technique as
 * api.envelope.test.js — mocking `agentsApi` itself (as the page test does)
 * would never have caught this, since the bug lives inside the wrapper.
 */

import { agentsApi, api } from '../api';

/**
 * A custom axios adapter is responsible for its OWN status-based
 * resolve/reject decision — unlike the built-in xhr/http adapters (which
 * call axios's internal `settle()` themselves), `dispatchRequest` does not
 * apply `validateStatus` on a custom adapter's behalf. So for a >=400
 * `status`, this throws an axios-error-shaped rejection directly, rather
 * than just returning a response object and assuming axios will reject it —
 * it will not, and the first version of this test file learned that the
 * hard way (a "500" fixture silently resolved, `r.data.data` came back
 * `undefined`, and the "rejects" assertion failed against a resolved
 * promise).
 */
function installAdapter(responses) {
  api.defaults.adapter = async (config) => {
    const url = (config.url || '').replace(/\?.*$/, '');
    const key = `${config.method.toUpperCase()} ${url}`;
    const entry = responses[key];
    if (entry === undefined) {
      throw new Error(`No fixture for "${key}".`);
    }
    const response = { data: entry.data, status: entry.status, statusText: entry.statusText || '', headers: {}, config };
    if (entry.status >= 400) {
      const err = new Error(`Request failed with status code ${entry.status}`);
      err.isAxiosError = true;
      err.config = config;
      err.response = response;
      throw err;
    }
    return response;
  };
}

beforeEach(() => {
  window.localStorage.setItem('scriptura.access_token', 'test-token');
});

afterEach(() => {
  window.localStorage.clear();
  delete api.defaults.adapter;
});

describe('agentsApi.getRecommendationActionOutcome — real 404 path through the real interceptor', () => {
  it('resolves to null (not a thrown error) for a real 404 OUTCOME_NOT_FOUND — the exact browser-reported bug', async () => {
    installAdapter({
      'GET /agents/recommendation-actions/2/outcome': {
        status: 404,
        statusText: 'Not Found',
        data: { error: { code: 'OUTCOME_NOT_FOUND', message: 'No outcome has been captured for action #2 yet.' } },
      },
    });

    await expect(agentsApi.getRecommendationActionOutcome(2)).resolves.toBeNull();
  });

  it('resolves to the outcome data for a real 200', async () => {
    const outcome = { id: 1, recommendation_id: 7, action_id: 5, status: 'evaluated', outcome: 'improved' };
    installAdapter({
      'GET /agents/recommendation-actions/5/outcome': { status: 200, data: { data: outcome } },
    });

    await expect(agentsApi.getRecommendationActionOutcome(5)).resolves.toEqual(outcome);
  });

  it('still propagates a genuine backend error (500) — the 404 handling does not swallow real failures', async () => {
    installAdapter({
      'GET /agents/recommendation-actions/9/outcome': {
        status: 500,
        data: { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } },
      },
    });

    await expect(agentsApi.getRecommendationActionOutcome(9)).rejects.toMatchObject({
      status: 500,
      code: 'INTERNAL_ERROR',
    });
  });

  it('still propagates a network error (no response at all)', async () => {
    api.defaults.adapter = async () => {
      const err = new Error('Network Error');
      throw err; // no `.response` — mirrors a real connection failure
    };

    await expect(agentsApi.getRecommendationActionOutcome(3)).rejects.toMatchObject({
      isNetwork: true,
    });
  });
});
