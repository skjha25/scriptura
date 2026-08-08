/**
 * Tailwind theme — single source of truth for Scriptura's visual language.
 *
 * Design system rules enforced here:
 *   1. Every color is a semantic token — no raw hex anywhere in components.
 *   2. Type scale combines size + weight + tracking — hierarchy is never size-only.
 *   3. Light and dark mode tokens are independently tuned, not inverted copies.
 *   4. Motion constants (duration, easing) are defined here and referenced everywhere.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx}', './public/index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      // -----------------------------------------------------------------------
      // Colors — 4 surface elevation levels, independently tuned per mode
      // -----------------------------------------------------------------------
      colors: {
        // Page background
        void: {
          DEFAULT: 'rgb(var(--color-void) / <alpha-value>)',
          soft: 'rgb(var(--color-void-soft) / <alpha-value>)',
        },

        // Surface levels
        panel: {
          DEFAULT: 'rgb(var(--color-panel) / <alpha-value>)',
          raised: 'rgb(var(--color-panel-raised) / <alpha-value>)',
          sunken: 'rgb(var(--color-panel-sunken) / <alpha-value>)',
        },

        // Typography
        ink: {
          DEFAULT: 'rgb(var(--color-ink) / <alpha-value>)',
          secondary: 'rgb(var(--color-ink-secondary) / <alpha-value>)',
          muted: 'rgb(var(--color-ink-muted) / <alpha-value>)',
          faint: 'rgb(var(--color-ink-faint) / <alpha-value>)',
        },

        // Accent
        accent: {
          DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
          bright: 'rgb(var(--color-accent-bright) / <alpha-value>)',
          deep: 'rgb(var(--color-accent-deep) / <alpha-value>)',
        },

        // Brand
        brand: {
          DEFAULT: 'rgb(var(--color-brand) / <alpha-value>)',
          light: 'rgb(var(--color-brand-light) / <alpha-value>)',
          subtle: 'rgb(var(--color-brand-subtle) / <alpha-value>)',
          darkSubtle: 'rgb(var(--color-brand-darkSubtle) / <alpha-value>)',
        },

        // Status
        status: {
          good: 'rgb(var(--color-status-good) / <alpha-value>)',
          warning: 'rgb(var(--color-status-warning) / <alpha-value>)',
          serious: 'rgb(var(--color-status-serious) / <alpha-value>)',
          critical: 'rgb(var(--color-status-critical) / <alpha-value>)',
        },
      },

      // Border colors
      borderColor: {
        hairline: 'rgb(var(--border-hairline) / <alpha-value>)',
        'hairline-strong': 'rgb(var(--border-hairline-strong) / <alpha-value>)',
      },

      // Shadows
      boxShadow: {
        panel: 'var(--shadow-panel)',
        'panel-raised': 'var(--shadow-panel-raised)',
        'panel-xl': 'var(--shadow-panel-xl)',
        glow: 'var(--shadow-glow)',
        'focus-ring': '0 0 0 2px rgb(var(--color-void)), 0 0 0 4px rgb(var(--color-brand))',
      },

      // -----------------------------------------------------------------------
      // Typography — Inter loaded from Google Fonts
      // -----------------------------------------------------------------------
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        numeric: ['Inter', 'system-ui', 'sans-serif'],
      },

      // -----------------------------------------------------------------------
      // Type scale with letter-spacing tokens
      // Large display text must be tight; body must breathe
      // -----------------------------------------------------------------------
      fontSize: {
        // Display — hero numbers, landing headings (32–48px range)
        'display': ['2.75rem', { lineHeight: '1.1', letterSpacing: '-0.03em', fontWeight: '700' }],
        'display-sm': ['2rem', { lineHeight: '1.15', letterSpacing: '-0.025em', fontWeight: '700' }],
        // H1 (24px)
        'heading-1': ['1.5rem', { lineHeight: '1.25', letterSpacing: '-0.02em', fontWeight: '600' }],
        // H2 (20px)
        'heading-2': ['1.25rem', { lineHeight: '1.3', letterSpacing: '-0.015em', fontWeight: '600' }],
        // H3 (16px)
        'heading-3': ['1rem', { lineHeight: '1.4', letterSpacing: '-0.01em', fontWeight: '600' }],
        // H4 (14px)
        'heading-4': ['0.875rem', { lineHeight: '1.4', letterSpacing: '0', fontWeight: '500' }],
        // Body large (16px)
        'body-lg': ['1rem', { lineHeight: '1.65', letterSpacing: '0' }],
        // Body (15px)
        'body': ['0.9375rem', { lineHeight: '1.6', letterSpacing: '0' }],
        // Body small (13px)
        'body-sm': ['0.8125rem', { lineHeight: '1.55', letterSpacing: '0.005em' }],
        // Caption / label (11–12px)
        'caption': ['0.75rem', { lineHeight: '1.5', letterSpacing: '0.01em' }],
        'label': ['0.6875rem', { lineHeight: '1.4', letterSpacing: '0.04em', fontWeight: '500' }],
      },

      letterSpacing: {
        tightest: '-0.03em',
        tighter: '-0.025em',
        tight: '-0.015em',
        snug: '-0.01em',
        normal: '0',
        wide: '0.01em',
        wider: '0.04em',
        widest: '0.08em',
      },

      // -----------------------------------------------------------------------
      // Motion — ONE system, defined here, referenced everywhere
      // -----------------------------------------------------------------------
      transitionDuration: {
        // Micro-interactions (hover states)
        fast: '150ms',
        // Standard UI transitions
        base: '200ms',
        // Page/section entrances
        slow: '400ms',
        // Elaborate entrance sequences
        slower: '600ms',
      },

      transitionTimingFunction: {
        // Primary easing for all entrances — "ease-out-expo" feel
        'expo-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
        // Micro-interactions and hover states
        'out': 'cubic-bezier(0.2, 0, 0, 1)',
        'in-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },

      keyframes: {
        // Standard page entrance
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // Fade only (for overlays, toasts)
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        // Scale in (for modals, menus)
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        // Skeleton loading shimmer
        shimmer: {
          '0%': { backgroundPosition: '-500px 0' },
          '100%': { backgroundPosition: '500px 0' },
        },
        'spin-slow': {
          to: { transform: 'rotate(360deg)' },
        },
        // Pulsing dot for in-flight badges
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
      },

      animation: {
        // All page/section entrances: expo-out, 400ms
        'fade-in-up': 'fade-in-up 400ms cubic-bezier(0.16, 1, 0.3, 1) both',
        // Overlay entrances: expo-out, 300ms
        'fade-in': 'fade-in 300ms cubic-bezier(0.16, 1, 0.3, 1) both',
        // Modal/menu entrances
        'scale-in': 'scale-in 300ms cubic-bezier(0.16, 1, 0.3, 1) both',
        // Skeleton
        shimmer: 'shimmer 1.6s linear infinite',
        // Spinner
        'spin-slow': 'spin-slow 1.4s linear infinite',
      },

      screens: {
        xs: '375px',
      },
    },
  },
  plugins: [],
};
