// frontend/src/App.js
/**
 * Routing.
 *
 * Everything except the login screen sits behind `<RequireAuth>`. Routes are
 * lazy-loaded per screen so the initial bundle carries the shell and the
 * dashboard rather than the block editor, the wizard and Recharts as well —
 * on a cold load that is the difference between a fast first paint and a slow one.
 */

import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';

import { useAuth } from './context/AuthContext';
import AppLayout from './components/layout/AppLayout';
import Spinner from './components/ui/Spinner';
import { EmptyState } from './components/ui/feedback';
import Button from './components/ui/Button';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const BlogListPage = lazy(() => import('./pages/BlogListPage'));
const WizardPage = lazy(() => import('./pages/WizardPage'));
const EditorPage = lazy(() => import('./pages/EditorPage'));
const BlogViewPage = lazy(() => import('./pages/BlogViewPage'));
const AutomatedBlogPage = lazy(() => import('./pages/AutomatedBlogPage'));
const KeywordsPage = lazy(() => import('./pages/KeywordsPage'));
const ClusterPage = lazy(() => import('./pages/ClusterPage'));
const ClusterDetailPage = lazy(() => import('./pages/ClusterDetailPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ConfigPage = lazy(() => import('./pages/ConfigPage'));
const ConfigIntegrationDetailPage = lazy(() => import('./pages/ConfigIntegrationDetailPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const AgentActivityPage = lazy(() => import('./pages/AgentActivityPage'));
const PlatformRulesPage = lazy(() => import('./pages/PlatformRulesPage'));
const AgentKnowledgePage = lazy(() => import('./pages/AgentKnowledgePage'));
const IntelligenceObservatoryPage = lazy(() => import('./pages/IntelligenceObservatoryPage'));
/** Full-screen loading state, used while a lazy route or the session resolves. */
function FullScreenLoader({ label = 'Loading' }) {
  return (
    <div className="flex min-h-screen items-center justify-center" aria-busy="true">
      <div className="flex flex-col items-center gap-3">
        <Spinner size={28} className="text-accent" label={label} />
        <p className="text-sm text-ink-muted">{label}…</p>
      </div>
    </div>
  );
}

/**
 * Gate for authenticated routes.
 *
 * Waits for `initialising` before deciding. Without that wait, a hard refresh
 * with a valid stored token would bounce to /login for a frame before /auth/me
 * resolved — the classic "logged out on refresh" flicker.
 *
 * The attempted path is passed in location state so login can return the user
 * where they were going.
 */
function RequireAuth({ children }) {
  const { isAuthenticated, initialising } = useAuth();
  const location = useLocation();

  if (initialising) return <FullScreenLoader label="Restoring your session" />;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return children;
}

/**
 * Gate for admin-only routes. Mounted inside `<RequireAuth>`, so `user` is
 * always already resolved here — no separate loading state needed.
 */
function RequireAdmin({ children }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;
  return children;
}

/** Redirects an already-signed-in user away from the login screen. */
function RedirectIfAuthenticated({ children }) {
  const { isAuthenticated, initialising } = useAuth();
  const location = useLocation();

  if (initialising) return <FullScreenLoader label="Checking your session" />;
  if (isAuthenticated) return <Navigate to={location.state?.from || '/'} replace />;
  return children;
}

function NotFoundPage() {
  return (
    <EmptyState
      icon="✧"
      title="Page not found"
      message="That route does not exist. It may have been renamed, or the link may be stale."
      action={
        <Button as="a" href="/" variant="primary">
          Back to dashboard
        </Button>
      }
    />
  );
}

export default function App() {
  return (
    <Suspense fallback={<FullScreenLoader />}>
      <Routes>
        <Route
          path="/welcome"
          element={
            <RedirectIfAuthenticated>
              <LandingPage />
            </RedirectIfAuthenticated>
          }
        />

        <Route
          path="/login"
          element={
            <RedirectIfAuthenticated>
              <LoginPage />
            </RedirectIfAuthenticated>
          }
        />

        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="blogs" element={<BlogListPage />} />
          {/* The wizard handles both a fresh blog and resuming a saved draft. */}
          <Route path="blogs/new" element={<WizardPage />} />
          <Route path="blogs/automated" element={<AutomatedBlogPage />} />
          <Route path="blogs/:id/wizard" element={<WizardPage />} />
          <Route path="blogs/:id/edit" element={<EditorPage />} />
          <Route path="blogs/:id" element={<BlogViewPage />} />
          <Route path="keywords" element={<KeywordsPage />} />
          <Route path="clusters" element={<ClusterPage />} />
          <Route path="clusters/:id" element={<ClusterDetailPage />} />
          <Route path="agents/activity" element={<AgentActivityPage />} />
          <Route path="agents/rules" element={<PlatformRulesPage />} />
          <Route path="agents/knowledge" element={<AgentKnowledgePage />} />
          <Route path="agents/observatory" element={<IntelligenceObservatoryPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="config" element={<ConfigPage />} />
          <Route path="config/new" element={<ConfigIntegrationDetailPage />} />
          <Route path="config/:id" element={<ConfigIntegrationDetailPage />} />
          <Route
            path="users"
            element={
              <RequireAdmin>
                <UsersPage />
              </RequireAdmin>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
