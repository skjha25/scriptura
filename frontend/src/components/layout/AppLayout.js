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

const NAV_ITEMS = [
  {
    to: '/',
    label: 'Dashboard',
    end: true,
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
  },
  {
    to: '/blogs',
    label: 'All blogs',
    end: true,
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
  {
    to: '/blogs/new',
    label: 'New article',
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
      </svg>
    ),
  },
  {
    to: '/blogs/automated',
    label: 'Autopilot Mode',
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    to: '/settings',
    label: 'Trending Topics',
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    to: '/keywords',
    label: 'Keyword Pool',
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 15.75V18m-7.5-6.75h.008v.008H8.25v-.008zm0 2.25h.008v.008H8.25v-.008zm0 2.25h.008v.008H8.25v-.008zm0 2.25h.008v.008H8.25v-.008zM12 8.25h.008v.008H12v-.008zm0 2.25h.008v.008H12v-.008zm0 2.25h.008v.008H12v-.008zm0 2.25h.008v.008H12v-.008zm0 2.25h.008v.008H12v-.008zM15.75 8.25h.008v.008H15.75v-.008zm0 2.25h.008v.008H15.75v-.008zm0 2.25h.008v.008H15.75v-.008zm0 2.25h.008v.008H15.75v-.008z" />
      </svg>
    ),
  },
  {
    to: '/clusters',
    label: 'Clusters',
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z" />
      </svg>
    ),
  },
  {
    to: '/agents/activity',
    label: 'Agent Activity',
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21M6.75 6.75h10.5v10.5H6.75V6.75z" />
      </svg>
    ),
  },
  {
    to: '/agents/rules',
    label: 'Platform Rules',
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 4.556-3.032 8.25-6.75 9.75-3.718-1.5-6.75-5.194-6.75-9.75V5.311a1.5 1.5 0 01.998-1.415A11.968 11.968 0 0012 3c1.985 0 3.87.512 5.502 1.416a1.5 1.5 0 01.998 1.415V12z" />
      </svg>
    ),
  },
  {
    to: '/agents/knowledge',
    label: 'Agent Knowledge',
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13M12 6.253C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s4.332.477 5.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
  },
];

function BrandLogo() {
  return (
    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#3B82F6] text-white shadow-sm">
      <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    </div>
  );
}

function NavItems({ onNavigate, collapsed = false }) {
  return (
    <nav className="space-y-1.5" aria-label="Main">
      {NAV_ITEMS.map((item) => (
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
          <span aria-hidden="true" className="shrink-0 text-accent">
            {item.icon}
          </span>
          <span className={clsx('truncate', collapsed && 'hidden lg:hidden')}>
            {item.label}
          </span>
        </NavLink>
      ))}
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
