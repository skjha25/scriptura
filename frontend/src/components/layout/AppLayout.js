/**
 * Application shell: sidebar navigation, top bar, and the routed outlet.
 * Supports folding/collapsing the left sidebar on desktop into a thin icon bar.
 */

import { useState, useEffect, Suspense } from 'react';
import { Outlet, NavLink, useLocation, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';

import { useAuth } from '../../context/AuthContext';
import Button from '../ui/Button';
import ThemeToggle from '../ui/ThemeToggle';
import AgentChatWidget from '../agents/AgentChatWidget';
import BrandLogo from './BrandLogo';
import { NAV_GROUPS } from '../../config/navigation';

function NavItems({ onNavigate, collapsed = false }) {
  const { isAdmin } = useAuth();

  return (
    <nav className="space-y-4" aria-label="Main">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((item) => !item.adminOnly || isAdmin);
        if (items.length === 0) return null;
        return (
          <div key={group.label} className="space-y-1.5">
            {!collapsed && (
              <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                {group.label}
              </p>
            )}
            {items.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                title={item.label}
                className={({ isActive }) =>
                  clsx(
                    'group relative flex items-center rounded-xl transition-all duration-150',
                    collapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5 text-sm',
                    isActive
                      ? 'bg-glow-subtle text-ink border border-accent/25'
                      : 'text-ink-secondary border border-transparent hover:bg-panel-raised hover:text-ink'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent"
                      />
                    )}
                    <span aria-hidden="true" className="shrink-0 text-accent">
                      <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                    </span>
                    <span className={clsx('truncate', collapsed && 'hidden lg:hidden')}>
                      {item.label}
                    </span>
                  </>
                )}
              </NavLink>
            );
            })}
          </div>
        );
      })}
    </nav>
  );
}

function ProviderNotice({ collapsed = false }) {
  const { features } = useAuth();

  const usingMock = features.text_provider === 'mock' || features.image_provider === 'mock';
  if (!usingMock || collapsed) return null;

  return (
    <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-2.5">
      <p className="text-xs font-medium text-status-warning">Mock AI provider</p>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
        {features.text_provider === 'mock' && features.image_provider === 'mock'
          ? 'No ANTHROPIC_API_KEY or OPENAI_API_KEY set — generated content and images are placeholders.'
          : features.text_provider === 'mock'
            ? 'No ANTHROPIC_API_KEY set — generated text is placeholder content.'
            : 'No OPENAI_API_KEY set — generated images are placeholders.'}
      </p>
    </div>
  );
}

function SidebarContent({ onNavigate, onClose, collapsed = false }) {
  const { user, logout } = useAuth();

  return (
    <div className={clsx('flex h-full flex-col gap-6 p-4', collapsed && 'items-center px-2')}>
      <div className="flex items-center justify-between">
        <Link
          to="/"
          onClick={onNavigate}
          title="Scriptura"
          className={clsx('flex items-center gap-2.5 px-2 py-1', collapsed && 'justify-center px-0')}
          aria-label="Scriptura home"
        >
          <BrandLogo />
          <span className={clsx('min-w-0', collapsed && 'hidden lg:hidden')}>
            <span className="block text-sm font-semibold leading-tight text-ink">Scriptura</span>
            <span className="block text-[11px] leading-tight text-ink-muted">Divinetalk content</span>
          </span>
        </Link>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            onTouchStart={onClose}
            aria-label="Close navigation"
            title="Close navigation"
            className="grid h-8 w-8 place-items-center rounded-lg border border-hairline text-ink-secondary hover:bg-panel-raised hover:text-ink transition-colors lg:hidden"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <NavItems onNavigate={onNavigate} collapsed={collapsed} />

      <div className="mt-auto space-y-3 w-full">
        <ProviderNotice collapsed={collapsed} />
        <div className={clsx('rounded-xl border border-hairline bg-panel-raised p-3', collapsed && 'px-1.5 py-3 text-center')}>
          {!collapsed ? (
            <>
              <p className="truncate text-sm text-ink">{user?.name}</p>
              <p className="truncate text-[11px] text-ink-muted">{user?.email}</p>
              <p className="mt-1 text-[11px] uppercase tracking-wide text-accent/80">{user?.role}</p>
              <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={logout}>
                Sign out
              </Button>
            </>
          ) : (
            <button
              type="button"
              onClick={logout}
              title="Sign out"
              aria-label="Sign out"
              className="mx-auto grid h-8 w-8 place-items-center rounded-lg text-ink-secondary hover:bg-panel hover:text-ink transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l3 3m0 0l-3 3m3-3H2.25" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('scriptura_sidebar_collapsed') === 'true';
  });

  const location = useLocation();

  useEffect(() => {
    localStorage.setItem('scriptura_sidebar_collapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // Handle escape key (removed buggy body overflow lock for iOS Safari).
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [drawerOpen]);

  return (
    <div
      className={clsx(
        'min-h-screen transition-all duration-300 ease-in-out lg:grid',
        sidebarCollapsed ? 'lg:grid-cols-[72px_1fr]' : 'lg:grid-cols-[260px_1fr]'
      )}
    >
      {/* Permanent sidebar from lg up. */}
      <aside className="hidden border-r border-hairline bg-panel/60 transition-all duration-300 ease-in-out lg:block">
        <div className="sticky top-0 h-screen overflow-y-auto">
          <SidebarContent collapsed={sidebarCollapsed} />
        </div>
      </aside>

      {/* Off-canvas drawer below lg. */}
      <AnimatePresence>
        {drawerOpen && (
          <motion.button
            type="button"
            key="drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            onClick={() => setDrawerOpen(false)}
            onPointerDown={() => setDrawerOpen(false)}
            onTouchStart={() => setDrawerOpen(false)}
            className="fixed inset-0 z-40 h-full w-full border-0 bg-black/75 p-0 backdrop-blur-sm cursor-pointer lg:hidden focus:outline-none"
            aria-label="Close navigation overlay"
          />
        )}
        {drawerOpen && (
          <motion.aside
            key="drawer-aside"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'tween', duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-y-0 left-0 z-50 w-[min(280px,85vw)] border-r border-hairline bg-panel shadow-2xl lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <SidebarContent
              onNavigate={() => setDrawerOpen(false)}
              onClose={() => setDrawerOpen(false)}
              collapsed={false}
            />
          </motion.aside>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-col">
        {/* Desktop top header bar with fold toggle and theme toggle. */}
        <header className="hidden border-b border-hairline bg-panel/30 px-4 py-3 lg:flex lg:items-center lg:justify-between">
          <button
            type="button"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-hairline bg-panel-raised p-2 text-xs text-ink-secondary transition-colors hover:bg-panel hover:text-ink"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              {sidebarCollapsed ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
              )}
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <AgentChatWidget agents={['chief_agent']} defaultAgent="chief_agent" variant="header" />
            <ThemeToggle />
          </div>
        </header>

        {/* Mobile top bar. */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-hairline bg-void/90 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen((prev) => !prev)}
              aria-label="Open navigation"
              aria-expanded={drawerOpen}
              className="grid h-9 w-9 place-items-center rounded-lg border border-hairline text-ink-secondary hover:text-ink"
            >
              <span aria-hidden="true">☰</span>
            </button>
            <Link to="/" className="flex items-center gap-2">
              <BrandLogo />
              <span className="text-sm font-semibold text-ink">Scriptura</span>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <AgentChatWidget agents={['chief_agent']} defaultAgent="chief_agent" variant="header" />
            <ThemeToggle />
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Suspense fallback={
            <div className="flex h-full items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-hairline border-t-accent" />
            </div>
          }>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
