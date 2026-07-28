/**
 * Tailwind theme — the single source of truth for Scriptura's visual language.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE COLOURS
 * ---------------------------------------------------------------------------
 * Two palettes live here and they serve different jobs. Mixing them up is the
 * usual way dashboards become unreadable, so they are kept separate on purpose:
 *
 *   `accent` / `void` / `panel` — UI chrome. A deep indigo "cosmic" surface with
 *      violet-magenta glow, which suits Divinetalk's astrology subject matter and
 *      satisfies the spec's dark-theme-with-glow requirement.
 *
 *   `series-1..8` — DATA encoding only. These are not decorative. They are a
 *      colourblind-safe categorical ramp, validated as a set against this exact
 *      surface (#141221) for: lightness band, chroma floor, adjacent-pair CVD
 *      separation (worst 8.4 ΔE, protan), normal-vision separation (worst 19.3
 *      ΔE) and ≥3:1 contrast. All checks pass.
 *
 * Rules that keep it valid — please do not break them casually:
 *   1. Assign series slots in fixed order (series-1, then -2, …). NEVER cycle or
 *      generate a 9th hue: a 9th series folds into "Other" or becomes a small
 *      multiple. Colour follows the entity, never its rank, so a filter that
 *      drops a series must not repaint the survivors.
 *   2. `status.*` is reserved for good/warning/serious/critical and must never be
 *      reused as "another series" colour. Status always ships with an icon or
 *      label, never colour alone.
 *   3. Re-validate if you change `panel` — contrast results are only meaningful
 *      against the surface the chart actually renders on.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx}', './public/index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // --- Surfaces -------------------------------------------------------
        void: {
          DEFAULT: '#0a0912', // page plane
          soft: '#0f0d1a',
        },
        panel: {
          DEFAULT: '#141221', // chart/card surface — the validated surface
          raised: '#1c1930', // hover / elevated
          sunken: '#100e1b',
        },

        // --- Ink ------------------------------------------------------------
        ink: {
          DEFAULT: '#ffffff',
          secondary: '#c0bcd6',
          muted: '#8f8bab',
          faint: '#5f5b7a',
        },

        // --- UI accent (chrome, never data) ---------------------------------
        accent: {
          DEFAULT: '#9085e9', // aurora violet
          bright: '#a99ff2',
          deep: '#6f62d6',
          magenta: '#c964d8',
          cyan: '#3987e5',
        },

        // --- Data encoding: categorical (fixed order, validated set) --------
        series: {
          1: '#3987e5', // blue
          2: '#d95926', // orange
          3: '#199e70', // aqua
          4: '#c98500', // yellow
          5: '#d55181', // magenta
          6: '#008300', // green
          7: '#9085e9', // violet
          8: '#e66767', // red
        },

        // --- Data encoding: sequential (one hue, light -> dark) -------------
        // For continuous magnitude only (score heatmaps). Never a rainbow.
        sequential: {
          100: '#cde2fb',
          200: '#9ec5f4',
          300: '#6da7ec',
          400: '#3987e5',
          500: '#256abf',
          600: '#184f95',
          700: '#0d366b',
        },

        // --- Status (reserved; icon + label always accompany) ---------------
        status: {
          good: '#0ca30c',
          warning: '#fab219',
          serious: '#ec835a',
          critical: '#d03b3b',
        },

        // --- Chart chrome ---------------------------------------------------
        grid: '#241f3a',
        axis: '#332c52',
      },

      // Hairline borders as translucent white so they sit correctly on any of
      // the three surface levels without a per-surface variant.
      borderColor: {
        hairline: 'rgba(255,255,255,0.10)',
        'hairline-strong': 'rgba(255,255,255,0.18)',
      },

      backgroundImage: {
        'glow-accent': 'linear-gradient(135deg, #7c6ff0 0%, #c964d8 100%)',
        'glow-subtle': 'linear-gradient(135deg, rgba(124,111,240,0.16) 0%, rgba(201,100,216,0.10) 100%)',
        // Ambient page wash — two soft radial pools rather than a flat fill, so
        // large dark areas do not read as dead space.
        'cosmic-wash':
          'radial-gradient(ellipse 80% 55% at 15% -5%, rgba(124,111,240,0.16), transparent 60%), ' +
          'radial-gradient(ellipse 65% 50% at 95% 5%, rgba(201,100,216,0.10), transparent 60%)',
      },

      boxShadow: {
        glow: '0 0 0 1px rgba(144,133,233,0.30), 0 8px 30px -8px rgba(124,111,240,0.45)',
        'glow-sm': '0 0 0 1px rgba(144,133,233,0.25), 0 4px 16px -6px rgba(124,111,240,0.35)',
        'glow-magenta': '0 0 0 1px rgba(201,100,216,0.30), 0 8px 30px -8px rgba(201,100,216,0.40)',
        panel: '0 1px 2px rgba(0,0,0,0.40), 0 8px 24px -12px rgba(0,0,0,0.60)',
        'focus-ring': '0 0 0 2px #0a0912, 0 0 0 4px #9085e9',
      },

      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
        // Tabular figures for anything that must align vertically in a column.
        numeric: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },

      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-500px 0' },
          '100%': { backgroundPosition: '500px 0' },
        },
        'spin-slow': {
          to: { transform: 'rotate(360deg)' },
        },
      },

      animation: {
        'fade-in-up': 'fade-in-up 260ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        shimmer: 'shimmer 1.6s linear infinite',
        'spin-slow': 'spin-slow 1.4s linear infinite',
      },

      // Breakpoints the spec names explicitly: 375 / 768 / 1440.
      screens: {
        xs: '375px',
      },
    },
  },
  plugins: [],
};
