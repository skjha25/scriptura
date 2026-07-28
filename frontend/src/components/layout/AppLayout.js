/**
 * Application shell: sidebar navigation, top bar, and the routed outlet.
 *
 * Responsive behaviour, which the spec calls out explicitly at 375 / 768 / 1440:
 *   - ≥1024px: the sidebar is a permanent column.
 *   - <1024px: it becomes an off-canvas drawer behind a hamburger, so the content
 *     column keeps its full width and nothing scrolls horizontally.
 *
 * The drawer is a focus trap in the sense that matters here: it closes on Escape
 * and on navigation, and the backdrop is clickable — implemented directly rather
 * than pulling in a modal library for one panel.
 */

import { useEffect, useState } from 'react';
import { Outlet, NavLink, useLocation, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';

import { useAuth } from '../../context/AuthContext';
import Button from '../ui/Button';

import ThemeToggle from '../ui/ThemeToggle';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '◈', end: true },
  { to: '/blogs', label: 'All blogs', icon: '☰', end: true },
  { to: '/blogs/new', label: 'New article', icon: '✦' },
];

function NavItems({ onNavigate }) {
  return (
    <nav className="space-y-1" aria-label="Main">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
              isActive
                ? 'bg-glow-subtle text-ink border border-accent/25'
                : 'text-ink-secondary border border-transparent hover:bg-panel-raised hover:text-ink'
            )
          }
        >
          <span aria-hidden="true" className="w-4 text-center text-accent">
            {item.icon}
          </span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

function ProviderNotice() {
  const { features } = useAuth();

  // Surfaces the degraded state rather than letting someone wonder why generated
  // copy looks canned. `mock` means no API key is configured.
  const usingMock = features.text_provider === 'mock' || features.image_provider === 'mock';
  if (!usingMock) return null;

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

function SidebarContent({ onNavigate }) {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <Link
          to="/"
          onClick={onNavigate}
          className="flex items-center gap-2.5"
          aria-label="Scriptura home"
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold leading-tight text-ink">Scriptura</span>
            <span className="block text-[11px] leading-tight text-ink-muted">Divinetalk content</span>
          </span>
        </Link>
        <ThemeToggle />
      </div>

      <NavItems onNavigate={onNavigate} />

      <div className="mt-auto space-y-3">
        <ProviderNotice />
        <div className="rounded-lg border border-hairline bg-panel-raised p-3">
          <p className="truncate text-sm text-ink">{user?.name}</p>
          <p className="truncate text-[11px] text-ink-muted">{user?.email}</p>
          <p className="mt-1 text-[11px] uppercase tracking-wide text-accent/80">{user?.role}</p>
          <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={logout}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // Any navigation closes the drawer — otherwise it stays open over the new page.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // Escape closes it, which is the expected affordance for any overlay.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    // Locks background scrolling while the drawer is open.
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      {/* Permanent sidebar from lg up. */}
      <aside className="hidden border-r border-hairline bg-panel/60 lg:block">
        <div className="sticky top-0 h-screen overflow-y-auto">
          <SidebarContent />
        </div>
      </aside>

      {/* Off-canvas drawer below lg. */}
      <AnimatePresence>
        {drawerOpen ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 z-40 bg-black/70 lg:hidden"
              aria-hidden="true"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed inset-y-0 left-0 z-50 w-[min(280px,85vw)] border-r border-hairline bg-panel lg:hidden"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
            >
              <SidebarContent onNavigate={() => setDrawerOpen(false)} />
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>

      <div className="flex min-w-0 flex-col">
        {/* Desktop top header bar. */}
        <header className="hidden border-b border-hairline bg-panel/30 px-6 py-3 lg:flex lg:items-center lg:justify-end">
          <ThemeToggle />
        </header>

        {/* Mobile top bar. Hidden from lg up, where the sidebar carries the brand. */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-hairline bg-void/90 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
              aria-expanded={drawerOpen}
              className="grid h-9 w-9 place-items-center rounded-lg border border-hairline text-ink-secondary hover:text-ink"
            >
              <span aria-hidden="true">☰</span>
            </button>
            <Link to="/" className="flex items-center gap-2">
              <span className="text-sm font-semibold text-ink">Scriptura</span>
            </Link>
          </div>
          <ThemeToggle />
        </header>

        {/* `min-w-0` on the flex child is what stops a wide table or long
            unbroken title from forcing horizontal page scroll. */}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
