// frontend/src/lib/api.js
/**
 * API client.
 *
 * One axios instance with two behaviours worth understanding:
 *
 * 1. TRANSPARENT TOKEN REFRESH. Access tokens are short-lived (15 minutes), so a
 *    401 mid-session is normal, not exceptional. The response interceptor catches
 *    it, exchanges the refresh token, and replays the original request — the
 *    calling component never learns it happened.
 *
 * 2. SINGLE-FLIGHT REFRESH. If five requests 401 at once, we must not fire five
 *    refreshes: the backend rotates the refresh token on every use, so the second
 *    through fifth would present an already-rotated token, be rejected as revoked,
 *    and log the user out. Instead the first 401 starts a refresh and the rest
 *    await the same promise.
 */

import axios from 'axios';

/**
 * Where the API lives.
 *
 * In development, CRA's `proxy` setting forwards /api to :5000, so a relative
 * base URL avoids CORS entirely. In production the app is served from the same
 * origin as the API, or REACT_APP_API_URL points at it.
 */
function resolveApiBase() {
  if (process.env.REACT_APP_API_URL) {
    return `${process.env.REACT_APP_API_URL.replace(/\/$/, '')}/api/v1`;
  }
  if (typeof window !== 'undefined' && window.location) {
    const path = window.location.pathname;
    const match = path.match(/^(\/[^/]+)/);
    if (
      match &&
      ![
        '/blogs',
        '/blog',
        '/login',
        '/welcome',
        '/api',
        '/agents',
        '/settings',
        '/keywords',
        '/clusters',
        '/config',
        '/users',
      ].includes(match[1])
    ) {
      return `${match[1]}/api/v1`;
    }
  }
  return '/api/v1';
}

const API_BASE = resolveApiBase();

const ACCESS_TOKEN_KEY = 'scriptura.access_token';
const REFRESH_TOKEN_KEY = 'scriptura.refresh_token';

// ---------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------

/**
 * Tokens live in localStorage so a page refresh does not sign the user out.
 *
 * The trade-off is understood: localStorage is readable by any script on the
 * origin, so an XSS would expose the tokens. An httpOnly refresh cookie would be
 * stronger, and the backend's CORS is already configured with `credentials: true`
 * so moving to one is a contained change. For an internal, non-public tool with a
 * sanitised content pipeline this is an acceptable position, and it is recorded in
 * ARCHITECTURE.md rather than left implicit.
 *
 * Reads are wrapped because localStorage throws in Safari private mode.
 */
export const tokenStore = {
  getAccess() {
    try {
      return localStorage.getItem(ACCESS_TOKEN_KEY);
    } catch {
      return null;
    }
  },
  getRefresh() {
    try {
      return localStorage.getItem(REFRESH_TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set({ access_token: accessToken, refresh_token: refreshToken }) {
    try {
      if (accessToken) localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
      if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    } catch {
      // Storage unavailable — the session simply will not survive a reload.
    }
  },
  clear() {
    try {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch {
      /* nothing to do */
    }
  },
};

// ---------------------------------------------------------------------------
// Instance
// ---------------------------------------------------------------------------

export const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  // Generation requests are slow by nature; the backend caps a provider call at
  // 120s, so the client allows a little more before giving up.
  timeout: 140000,
});

api.interceptors.request.use((requestConfig) => {
  const token = tokenStore.getAccess();
  if (token) {
    requestConfig.headers.Authorization = `Bearer ${token}`;
  }
  return requestConfig;
});

/**
 * Called when refresh fails and the session is unrecoverable. AuthContext
 * registers a handler so it can clear state and redirect to the login screen —
 * this module deliberately knows nothing about React or routing.
 */
let onSessionExpired = () => {};
export function setSessionExpiredHandler(handler) {
  onSessionExpired = typeof handler === 'function' ? handler : () => {};
}

/** The in-flight refresh, shared by every request waiting on it. */
let refreshPromise = null;

/** Endpoints that must never trigger a refresh-and-retry cycle. */
function isAuthEndpoint(url = '') {
  return url.includes('/auth/login') || url.includes('/auth/refresh');
}

async function performRefresh() {
  const refreshToken = tokenStore.getRefresh();
  if (!refreshToken) throw new Error('No refresh token available.');

  // A bare axios call, not `api`: going through the instance would attach the
  // dead access token and re-enter this interceptor on failure.
  const { data } = await axios.post(
    `${API_BASE}/auth/refresh`,
    { refresh_token: refreshToken },
    { headers: { 'Content-Type': 'application/json' }, timeout: 20000 }
  );

  tokenStore.set(data);
  return data.access_token;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;

    // Not an auth problem, or nothing to retry — pass it through.
    if (!original || error.response?.status !== 401 || isAuthEndpoint(original.url)) {
      return Promise.reject(normalizeError(error));
    }

    // Retry once only. Without this flag a persistently-401ing endpoint would
    // loop forever.
    if (original._retried) {
      tokenStore.clear();
      onSessionExpired();
      return Promise.reject(normalizeError(error));
    }
    original._retried = true;

    try {
      // Single-flight: concurrent 401s all await the same refresh.
      if (!refreshPromise) {
        refreshPromise = performRefresh().finally(() => {
          refreshPromise = null;
        });
      }
      const newToken = await refreshPromise;

      original.headers = { ...original.headers, Authorization: `Bearer ${newToken}` };
      return api(original);
    } catch (refreshError) {
      tokenStore.clear();
      onSessionExpired();
      return Promise.reject(normalizeError(error, refreshError));
    }
  }
);

// ---------------------------------------------------------------------------
// Error normalisation
// ---------------------------------------------------------------------------

/**
 * Flattens every failure mode into one predictable shape, so components render
 * errors without knowing whether the cause was HTTP, network, or a timeout.
 *
 * @returns {{message: string, code: string, status: number|null, fieldErrors: object|null, isNetwork: boolean}}
 */
export function normalizeError(error, cause) {
  const status = error.response?.status ?? null;
  const payload = error.response?.data?.error;

  if (payload) {
    return {
      message: payload.message || 'Something went wrong.',
      code: payload.code || 'ERROR',
      status,
      fieldErrors: payload.details?.fieldErrors || null,
      retryAfterSeconds: payload.details?.retryAfterSeconds ?? null,
      isNetwork: false,
      cause,
    };
  }

  if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
    return {
      message: 'The request timed out. Generation can take a while — check the blog list before retrying.',
      code: 'TIMEOUT',
      status,
      fieldErrors: null,
      isNetwork: true,
      cause,
    };
  }

  if (!error.response) {
    return {
      message: 'Cannot reach the server. Check that the API is running on port 5000.',
      code: 'NETWORK_ERROR',
      status: null,
      fieldErrors: null,
      isNetwork: true,
      cause,
    };
  }

  return {
    message: error.message || 'Something went wrong.',
    code: 'ERROR',
    status,
    fieldErrors: null,
    isNetwork: false,
    cause,
  };
}

// ---------------------------------------------------------------------------
// Endpoint wrappers
// ---------------------------------------------------------------------------
// Thin, named functions rather than raw api.get() calls at the call sites, so a
// route change touches one file and component code reads as intent.
//
// ⚠️ THE RESPONSE ENVELOPE IS NOT UNIFORM. Two shapes exist on the backend and
// these wrappers are the single place that difference is absorbed, so no component
// has to know about it:
//
//   `{ data: … }`   blogs (except generation-status) and analytics
//                   → unwrap with `r.data.data`
//   top level       generation, brand voice, media, SERP, and
//                   /blogs/:id/generation-status (which is the generation
//                   controller's handler mounted under the blogs route)
//                   → unwrap with `r.data`
//
// Getting this wrong is silent: the promise resolves to `undefined` rather than
// throwing, so the UI renders an empty state and looks like a data problem. Check
// the controller's `res.json(...)` before adding a wrapper here.

export const authApi = {
  login: (email, password) => api.post('/auth/login', { email, password }).then((r) => r.data),
  logout: () => api.post('/auth/logout').then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
};

export const metaApi = {
  /** Capability probe — which optional features are actually available. */
  get: () => api.get('/meta').then((r) => r.data),
};

export const blogsApi = {
  list: (params) => api.get('/blogs', { params }).then((r) => r.data),
  get: (id) => api.get(`/blogs/${id}`).then((r) => r.data.data),
  create: (payload) => api.post('/blogs', payload).then((r) => r.data.data),
  update: (id, payload) => api.patch(`/blogs/${id}`, payload).then((r) => r.data.data),
  remove: (id) => api.delete(`/blogs/${id}`).then((r) => r.data),
  restore: (id) => api.post(`/blogs/${id}/restore`).then((r) => r.data.data),
  // Spread, not replaced: every existing caller reads the blog's own fields
  // (blog_status, etc.) directly off the resolved value — `delivery` is
  // added alongside them, never nested, so nothing that already works here
  // has to change. See backend/src/controllers/blogs.controller.js's
  // `publish` handler for what populates it (empty array when no client
  // integration is configured/enabled).
  publish: (id, payload = {}) => api.post(`/blogs/${id}/publish`, payload).then((r) => ({ ...r.data.data, delivery: r.data.delivery || [] })),
  linkable: (params) => api.get('/blogs/linkable', { params }).then((r) => r.data.data),
  /**
   * Top-level, not `{data}`: this route is the generation controller's
   * `generationStatusHandler` mounted under /blogs for the spec's URL shape, so it
   * follows the generation envelope rather than the blogs one.
   */
  generationStatus: (id) => api.get(`/blogs/${id}/generation-status`).then((r) => r.data),
  /** Regenerates exactly one image content block. `prompt` is optional. */
  regenerateBlockImage: (id, blockId, prompt) =>
    api
      .patch(`/blogs/${id}/blocks/${blockId}/regenerate-image`, prompt ? { prompt } : {})
      .then((r) => r.data.data),
};

// Generation, brand voice, media and SERP all respond at the top level.
export const generateApi = {
  titles: (payload) => api.post('/generate/title', payload).then((r) => r.data),
  outline: (payload) => api.post('/generate/outline', payload).then((r) => r.data),
  article: (payload) => api.post('/generate/article', payload).then((r) => r.data),
  autoTopic: () => api.post('/generate/auto-topic').then((r) => r.data),
};

export const brandVoiceApi = {
  /** Text or URL analysis. */
  analyze: (payload) => api.post('/brand-voice/analyze', payload).then((r) => r.data),
  /**
   * File upload analysis. A separate function because it needs multipart, and
   * the Content-Type must be left for the browser to set so it can add the
   * multipart boundary.
   */
  analyzeFile: (file) => {
    const form = new FormData();
    form.append('file', file);
    return api
      .post('/brand-voice/analyze', form, { headers: { 'Content-Type': undefined } })
      .then((r) => r.data);
  },
};

export const mediaApi = {
  upload: (file, options = {}) => {
    const form = new FormData();
    form.append('image', file);
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined && value !== null) form.append(key, String(value));
    });
    return api
      .post('/media/upload', form, { headers: { 'Content-Type': undefined } })
      .then((r) => r.data);
  },
  generateImage: (payload) => api.post('/media/generate-image', payload).then((r) => r.data),
  compositeLogo: (payload) => api.post('/media/composite-logo', payload).then((r) => r.data),
};

export const serpApi = {
  checkRank: (payload) => api.post('/serp/check-rank', payload).then((r) => r.data),
  groundFacts: (payload) => api.post('/serp/ground-facts', payload).then((r) => r.data),
};

export const gscApi = {
  /** Manual on-demand fetch+store — see backend/src/controllers/gsc.controller.js. */
  sync: (payload = {}) => api.post('/gsc/sync', payload).then((r) => r.data),
};

/**
 * Config page: client publish-API integrations. `has_secret` (never a
 * decrypted secret) reflects whether a credential is set — see
 * backend/src/controllers/publishingIntegration.controller.js.
 */
export const publishingConfigApi = {
  availableFields: () => api.get('/config/available-fields').then((r) => r.data.data),
  list: () => api.get('/config/integrations').then((r) => r.data.data),
  get: (id) => api.get(`/config/integrations/${id}`).then((r) => r.data.data),
  create: (payload) => api.post('/config/integrations', payload).then((r) => r.data.data),
  update: (id, payload) => api.patch(`/config/integrations/${id}`, payload).then((r) => r.data.data),
  replaceFieldMappings: (id, mappings) =>
    api.put(`/config/integrations/${id}/field-mappings`, { mappings }).then((r) => r.data.data),
  testConnection: (id, payload = {}) => api.post(`/config/integrations/${id}/test-connection`, payload).then((r) => r.data),
  deliveryLogs: (id, params) => api.get(`/config/integrations/${id}/delivery-logs`, { params }).then((r) => r.data),
  retryDelivery: (logId) => api.post(`/config/delivery-logs/${logId}/retry`).then((r) => r.data.data),
};

/**
 * Users page: platform user management. Admin-only on the backend
 * (requireAdmin) — see backend/src/controllers/users.controller.js. Never
 * returns a password hash; `toSafeJSON()` on the backend guarantees that.
 */
export const usersApi = {
  list: (params) => api.get('/users', { params }).then((r) => r.data),
  create: (payload) => api.post('/users', payload).then((r) => r.data.data),
  update: (id, payload) => api.patch(`/users/${id}`, payload).then((r) => r.data.data),
};

export const analyticsApi = {
  overview: (params) => api.get('/analytics/overview', { params }).then((r) => r.data.data),
  inFlight: () => api.get('/analytics/in-flight').then((r) => r.data.data),
};

export const settingsApi = {
  getTopics: () => api.get('/settings/topics').then((r) => r.data.data),
  suggestTopics: () => api.get('/settings/topics/suggest').then((r) => r.data.data),
  addTopic: (payload) => api.post('/settings/topics', payload).then((r) => r.data.data),
  deleteTopic: (id) => api.delete(`/settings/topics/${id}`),
};

/**
 * P6: global, org-scoped content-configuration settings (image defaults
 * today; fact sources and reusable links join this same object as later P6
 * sub-phases). Backend: controllers/settings.controller.js,
 * ScripturaSettings-backed, read automatically by every image-generation
 * call site. Never per-user — see that controller's own comment on why.
 */
export const contentSettingsApi = {
  getImageDefaults: () => api.get('/settings/image-defaults').then((r) => r.data.data),
  updateImageDefaults: (payload) => api.put('/settings/image-defaults', payload).then((r) => r.data.data),
};

/**
 * P6-B: Fact Verification source management — real CRUD over
 * `content.fact_sources`/`content.fact_verification_policy`
 * (controllers/factSources.controller.js). `addSource` is JSON
 * (website/reference_text); `uploadSource` is multipart (document/pdf) — two
 * functions because the backend genuinely has two endpoints for this, not
 * an arbitrary frontend split.
 */
export const factSourcesApi = {
  list: () => api.get('/settings/fact-sources').then((r) => r.data.data),
  addSource: (payload) => api.post('/settings/fact-sources', payload).then((r) => r.data.data),
  uploadSource: (formData) =>
    api.post('/settings/fact-sources/upload', formData, { headers: { 'Content-Type': undefined } }).then((r) => r.data.data),
  updateSource: (id, payload) => api.put(`/settings/fact-sources/${id}`, payload).then((r) => r.data.data),
  removeSource: (id) => api.delete(`/settings/fact-sources/${id}`),
  updatePolicy: (policy) => api.put('/settings/fact-verification-policy', { policy }).then((r) => r.data.data),
};

export const keywordsApi = {
  list: (params) => api.get('/keywords', { params }).then((r) => r.data),
  create: (payload) => api.post('/keywords', payload).then((r) => r.data.data),
  update: (id, payload) => api.put(`/keywords/${id}`, payload).then((r) => r.data.data),
  remove: (id) => api.delete(`/keywords/${id}`).then((r) => r.data.data),
  bulkImport: (payload) => api.post('/keywords/bulk-import', payload).then((r) => r.data),
  suggest: (topic) => api.get('/keywords/suggest', { params: { topic } }).then((r) => r.data.data),
};

export const clustersApi = {
  list: (params) => api.get('/clusters', { params }).then((r) => r.data),
  get: (id) => api.get(`/clusters/${id}`).then((r) => r.data.data),
  create: (payload) => api.post('/clusters', payload).then((r) => r.data.data),
  update: (id, payload) => api.patch(`/clusters/${id}`, payload).then((r) => r.data.data),
  remove: (id) => api.delete(`/clusters/${id}`).then((r) => r.data.data),
  expand: (id, payload) => api.post(`/clusters/${id}/expand`, payload).then((r) => r.data.data),
  checkCannibalization: (payload) => api.post('/clusters/check-cannibalization', payload).then((r) => r.data.data),
  updateKeyword: (id, keywordId, payload) => api.patch(`/clusters/${id}/keywords/${keywordId}`, payload).then((r) => r.data.data),
  removeKeyword: (id, keywordId) => api.delete(`/clusters/${id}/keywords/${keywordId}`).then((r) => r.data.data),
  checkTimeSlot: (datetime, excludeKeywordId) => api.get('/clusters/check-time-slot', { params: { datetime, exclude_keyword_id: excludeKeywordId } }).then((r) => r.data.data),
  scheduleAll: (id, payload) => api.post(`/clusters/${id}/schedule-all`, payload).then((r) => r.data.data),
  autoSchedule: (id, payload) => api.post(`/clusters/${id}/auto-schedule`, payload).then((r) => r.data.data),
};

export const autopilotSettingsApi = {
  get: () => api.get('/settings/autopilot').then((r) => r.data.data),
  update: (payload) => api.put('/settings/autopilot', payload).then((r) => r.data.data),
};

export const agentsApi = {
  /** One chat turn with a specific agent — never routes through the Chief Agent from the UI. */
  chat: (agentName, payload) => api.post(`/agents/${agentName}/chat`, payload).then((r) => r.data.data),
  /** This admin's last conversation with this agent — for the widget to reload on mount. */
  getHistory: (agentName) => api.get(`/agents/${agentName}/history`).then((r) => r.data.data),
  /** Marks the widget's visible thread as cleared — never deletes the underlying audit rows. */
  clearHistory: (agentName) => api.post(`/agents/${agentName}/history/clear`).then((r) => r.data.data),
  /** Current value of an agent-controlled setting, no model call spent. */
  getSetting: (key) => api.get(`/agents/settings/${key}`).then((r) => r.data.data),
  /** The only call that actually persists a proposed change — always an explicit human click. */
  applySetting: (payload) => api.post('/agents/settings/apply', payload).then((r) => r.data.data),
  revertSetting: (payload) => api.post('/agents/settings/revert', payload).then((r) => r.data.data),
  /** The entity-mutation counterpart to applySetting — cluster/keyword-pool/topic writes. */
  applyProposal: (payload) => api.post('/agents/proposals/apply', payload).then((r) => r.data.data),
  listActivity: (params) => api.get('/agents/activity', { params }).then((r) => r.data.data),
  /** Hardcoded directives no agent can ever propose changing — read-only reference. */
  getGoldenRules: () => api.get('/agents/golden-rules').then((r) => r.data.data),
  /** "Teach it something new" — analyses samples into a DRAFT profile, never persists it. */
  extractStyleProfile: (payload) => api.post('/agents/generate/style-profile/extract', payload).then((r) => r.data.data),
  /** The only call that persists a style-profile draft as the live, confirmed one. */
  confirmStyleProfile: (payload) => api.post('/agents/generate/style-profile/confirm', payload).then((r) => r.data.data),
  /** Logs that the admin explicitly rejected a proposed change — never writes any real state. */
  dismissChange: (agentName, payload) => api.post(`/agents/${agentName}/dismiss`, payload).then((r) => r.data.data),
  /** Which knowledge rows (if any) were retrieved and used for a given chat turn. */
  getKnowledgeUsage: (traceId) => api.get('/agents/knowledge-usage', { params: { trace_id: traceId } }).then((r) => r.data.data),
  /**
   * P1-A: structured recommendations (agent_recommendations), completely
   * separate from the proposed_change Apply flow above — see
   * AgentActivityPage.js's "Pending Recommendations" section. Defaults to
   * the pending ("recommended") view when no params are given.
   */
  listRecommendations: (params) => api.get('/agents/recommendations', { params }).then((r) => r.data.data),
  approveRecommendation: (id) => api.post(`/agents/recommendations/${id}/approve`).then((r) => r.data.data),
  rejectRecommendation: (id) => api.post(`/agents/recommendations/${id}/reject`).then((r) => r.data.data),
  /** Decides every currently-pending recommendation at once, not just a loaded page. */
  bulkApproveRecommendations: () => api.post('/agents/recommendations/bulk-approve').then((r) => r.data.data),
  bulkRejectRecommendations: () => api.post('/agents/recommendations/bulk-reject').then((r) => r.data.data),
  /**
   * P1-B: recommendation action tracking (recommendation_actions), completely
   * separate from the proposed_change Apply flow — see AgentActivityPage.js's
   * "Approved — Awaiting Action" section. An action is never auto-created by
   * approval; createRecommendationAction is its own explicit human step.
   */
  listRecommendationActions: (id) => api.get(`/agents/recommendations/${id}/actions`).then((r) => r.data.data),
  createRecommendationAction: (id, payload) =>
    api.post(`/agents/recommendations/${id}/actions`, payload).then((r) => r.data.data),
  completeRecommendationAction: (id, payload) =>
    api.post(`/agents/recommendation-actions/${id}/complete`, payload).then((r) => r.data.data),
  failRecommendationAction: (id, payload) =>
    api.post(`/agents/recommendation-actions/${id}/fail`, payload).then((r) => r.data.data),
  cancelRecommendationAction: (id) => api.post(`/agents/recommendation-actions/${id}/cancel`).then((r) => r.data.data),
  /**
   * P1-B4: performs the real, whitelisted Blog mutation for an automated
   * action (executor_type==='automated'). No request body — result_summary
   * is server-computed only.
   */
  executeRecommendationAction: (id) => api.post(`/agents/recommendation-actions/${id}/execute`).then((r) => r.data.data),
  /**
   * P2-D: read-only outcome data (baseline/fresh evidence, metric_deltas,
   * classification) for one action, if any was ever captured. Resolves to
   * `null` — not a thrown error — when no outcome exists yet (OUTCOME_NOT_FOUND
   * is an expected, common state: the action may predate outcome tracking,
   * may not be completed, or nothing was metric-observable), so callers can
   * treat "no outcome yet" as data, not as a page-level failure. Any other
   * error (network, 401/403, 500) still propagates normally.
   *
   * IMPORTANT: `api`'s response interceptor (above) already ran every
   * rejection through `normalizeError()` before this `.catch` ever sees it —
   * by this point `err` is `{message, code, status, ...}`, never a raw axios
   * error, so there is no `err.response` here at all. Checking
   * `err.response?.status` (the pre-interceptor shape) always silently
   * misses, and the 404 re-throws as a generic error instead of resolving to
   * `null` — exactly the bug this comment is here to stop from recurring.
   */
  getRecommendationActionOutcome: (id) =>
    api
      .get(`/agents/recommendation-actions/${id}/outcome`)
      .then((r) => r.data.data)
      .catch((err) => {
        if (err.status === 404) return null;
        throw err;
      }),
  /**
   * P4-D: learning candidate review (learning_candidates) — patterns
   * detected from real recommendation_outcome data, awaiting a human
   * confirm/reject decision. Defaults to nothing filtered; the caller
   * narrows via `{status, agent_name}`. See
   * services/agents/learningCandidateDecisions.js on the backend — this is
   * a thin client over that existing, unmodified API.
   */
  listLearningCandidates: (params) => api.get('/agents/learning-candidates', { params }).then((r) => r.data.data),
  /**
   * `scope` is omitted (never sent as `undefined`/`null`) for an
   * agent-scoped confirm — the backend defaults to 'agent' when the key is
   * absent. `scope:'global'` is only ever sent when the caller passes it
   * explicitly, so an agent-scope confirm can never accidentally promote to
   * global through this wrapper.
   */
  confirmLearningCandidate: (id, scope) =>
    api.post(`/agents/learning-candidates/${id}/confirm`, scope === 'global' ? { scope: 'global' } : {}).then((r) => r.data.data),
  rejectLearningCandidate: (id) => api.post(`/agents/learning-candidates/${id}/reject`).then((r) => r.data.data),
};

/**
 * P5-D: Intelligence Observatory — read-only aggregation over the existing
 * P0-P5 lifecycle (services/agents/observatory.js on the backend). Every
 * call here is a GET; nothing in this object can write anything.
 */
export const observatoryApi = {
  getSummary: () => api.get('/agents/observatory/summary').then((r) => r.data.data),
  getAgents: () => api.get('/agents/observatory/agents').then((r) => r.data.data),
  getActivity: (params) => api.get('/agents/observatory/activity', { params }).then((r) => r.data.data),
  getKnowledgeHealth: (agentName) =>
    api.get('/agents/observatory/knowledge-health', { params: agentName ? { agent_name: agentName } : {} }).then((r) => r.data.data),
  getKnowledgeNodes: (agentName, limit) =>
    api
      .get('/agents/observatory/knowledge-nodes', { params: { ...(agentName ? { agent_name: agentName } : {}), ...(limit ? { limit } : {}) } })
      .then((r) => r.data.data),
  getKnowledgeConnections: (id) => api.get(`/agents/observatory/knowledge/${id}/connections`).then((r) => r.data.data),
};

/**
 * Knowledge & Learning Layer — the shared "teach this agent" mechanism for
 * every agent except generate_agent (which keeps agentsApi's own
 * extractStyleProfile/confirmStyleProfile above). See
 * services/agents/knowledge/knowledgeBase.js on the backend.
 */
export const knowledgeApi = {
  /** This agent's current retrievable knowledge (global + its own scope), read-only. */
  get: (agentName) => api.get(`/agents/${agentName}/knowledge-base`).then((r) => r.data.data),
  /**
   * Ingests+extracts+validates one submission into a DRAFT batch — never
   * persists. `formData` carries text_samples/links/image_paths/youtube_links
   * as JSON-stringified fields (multer flattens everything to strings) plus
   * an optional `video` file field.
   */
  extract: (agentName, formData) =>
    api
      .post(`/agents/${agentName}/knowledge-base/extract`, formData, { headers: { 'Content-Type': undefined } })
      .then((r) => r.data.data),
  /**
   * The only call that persists a reviewed batch — each item carries its own
   * accept/skip decision. `scope` is batch-level: 'global' makes every
   * accepted item in this batch visible to every agent, not just this one.
   * Omitted (or 'agent') keeps the existing agent-scoped behavior.
   */
  confirm: (agentName, items, scope) =>
    api.post(`/agents/${agentName}/knowledge-base/confirm`, { items, ...(scope ? { scope } : {}) }).then((r) => r.data.data),
};

export default api;
