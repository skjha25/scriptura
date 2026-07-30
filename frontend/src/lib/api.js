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
    if (match && !['/blogs', '/login', '/api'].includes(match[1])) {
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
  publish: (id, payload = {}) => api.post(`/blogs/${id}/publish`, payload).then((r) => r.data.data),
  linkable: (params) => api.get('/blogs/linkable', { params }).then((r) => r.data.data),
  /**
   * Top-level, not `{data}`: this route is the generation controller's
   * `generationStatusHandler` mounted under /blogs for the spec's URL shape, so it
   * follows the generation envelope rather than the blogs one.
   */
  generationStatus: (id) => api.get(`/blogs/${id}/generation-status`).then((r) => r.data),
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

export default api;
