/**
 * Authentication state.
 *
 * Holds the signed-in user and the app's capability flags (which optional
 * backend features are actually available). Both are needed by almost every
 * screen, and both are resolved once on boot.
 */

import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { authApi, metaApi, tokenStore, setSessionExpiredHandler, normalizeError } from '../lib/api';

const AuthContext = createContext(null);

/**
 * Capability defaults used before /meta responds, and if it fails.
 *
 * Optional features default to OFF. If the probe fails we would rather hide a
 * SERP button that might have worked than show one that definitely will not —
 * a disabled-looking feature is a smaller problem than a control that 503s.
 */
const DEFAULT_FEATURES = Object.freeze({
  serp_api: false,
  text_provider: 'unknown',
  image_provider: 'unknown',
  storage_driver: 'local',
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [features, setFeatures] = useState(DEFAULT_FEATURES);
  /**
   * Distinguishes "still checking whether a stored token is valid" from
   * "definitely signed out". Without it the login screen flashes on every
   * refresh before /auth/me resolves.
   */
  const [initialising, setInitialising] = useState(true);
  const [error, setError] = useState(null);

  /** Clears local session state. Does not call the API. */
  const clearSession = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  // The api module calls this when a refresh fails, i.e. the session is
  // unrecoverable. Registered here so that module stays free of React imports.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      clearSession();
      setError({
        code: 'SESSION_EXPIRED',
        message: 'Your session expired. Please sign in again.',
      });
    });
    return () => setSessionExpiredHandler(null);
  }, [clearSession]);

  // Boot: resolve capabilities, and hydrate the user if a token is present.
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      // /meta is unauthenticated, so it is fetched regardless — the login screen
      // uses it to show which providers are configured.
      const metaPromise = metaApi
        .get()
        .then((data) => {
          if (!cancelled && data?.features) setFeatures({ ...DEFAULT_FEATURES, ...data.features });
        })
        .catch(() => {
          // Non-fatal: defaults already hide optional features.
        });

      if (tokenStore.getAccess()) {
        try {
          const { user: me } = await authApi.me();
          if (!cancelled) setUser(me);
        } catch {
          // A stored token that no longer works is not an error worth showing —
          // the interceptor already tried to refresh it. Treat as signed out.
          if (!cancelled) clearSession();
        }
      }

      await metaPromise;
      if (!cancelled) setInitialising(false);
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  const login = useCallback(async (email, password) => {
    setError(null);
    try {
      const data = await authApi.login(email, password);
      tokenStore.set(data);
      setUser(data.user);
      return data.user;
    } catch (err) {
      const normalized = err.code ? err : normalizeError(err);
      setError(normalized);
      throw normalized;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Revoking server-side is best-effort. Whatever happens, the local session
      // ends — refusing to sign out because the network is down would be worse.
    } finally {
      clearSession();
      setError(null);
    }
  }, [clearSession]);

  const value = useMemo(
    () => ({
      user,
      features,
      initialising,
      error,
      isAuthenticated: Boolean(user),
      isAdmin: user?.role === 'admin',
      login,
      logout,
      clearError: () => setError(null),
    }),
    [user, features, initialising, error, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an <AuthProvider>.');
  }
  return context;
}

/** Capability flags on their own, for components that do not need the user. */
export function useFeatures() {
  return useAuth().features;
}

export default AuthContext;
