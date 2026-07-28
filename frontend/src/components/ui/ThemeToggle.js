// frontend/src/components/ui/ThemeToggle.js
import { useEffect, useState } from 'react';

export default function ThemeToggle({ className = '' }) {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('scriptura_theme') || 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
    }
    localStorage.setItem('scriptura_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={`group relative inline-flex items-center gap-2 rounded-xl border border-hairline bg-panel-raised p-1.5 text-xs font-medium text-ink transition-all duration-200 hover:border-hairline-strong hover:bg-panel active:scale-[0.97] ${className}`}
    >
      <div
        className={`grid h-6 w-6 place-items-center rounded-lg transition-all duration-200 ${
          isDark
            ? 'bg-amber-500/15 text-amber-400'
            : 'bg-indigo-500/15 text-indigo-600'
        }`}
      >
        {isDark ? (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 3v2.25m0 13.5V21m8.966-8.966h-2.25M4.284 12h-2.25m15.364-6.364l-1.591 1.591M6.343 17.657l-1.591 1.591m12.728 0l-1.591-1.591M6.343 6.343L4.752 4.752M12 7.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9z"
            />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"
            />
          </svg>
        )}
      </div>
      <span className="pr-1 text-xs font-medium text-ink-secondary group-hover:text-ink">
        {isDark ? 'Light mode' : 'Dark mode'}
      </span>
    </button>
  );
}
