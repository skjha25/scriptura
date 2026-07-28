/**
 * Tailwind theme — the single source of truth for Scriptura's visual language.
 * Ultra-Premium AI SaaS Dark Luxury Theme.
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
          DEFAULT: '#09090C', // ultra-deep obsidian page background
          soft: '#0D0D12',
        },
        panel: {
          DEFAULT: '#111116', // sleek glass card surface
          raised: '#1A1A24', // elevated hover surface
          sunken: '#0C0C10', // sunken input surface
        },

        // --- Ink ------------------------------------------------------------
        ink: {
          DEFAULT: '#FFFFFF',
          secondary: '#A1A1AA',
          muted: '#71717A',
          faint: '#52525B',
        },

        // --- UI Accent (AI Electric & Cosmic Glow) ---------------------------
        accent: {
          DEFAULT: '#4F8CFF', // vibrant AI electric blue
          bright: '#60A5FA',
          deep: '#3B82F6',
          violet: '#8B5CF6',
          magenta: '#EC4899',
          cyan: '#06B6D4',
        },

        // --- Data encoding: categorical -------------------------------------
        series: {
          1: '#4F8CFF', // blue
          2: '#F97316', // orange
          3: '#10B981', // emerald
          4: '#F59E0B', // amber
          5: '#EC4899', // pink
          6: '#06B6D4', // cyan
          7: '#8B5CF6', // violet
          8: '#EF4444', // red
        },

        // --- Data encoding: sequential (score heatmaps) ---------------------
        sequential: {
          100: '#DBEAFE',
          200: '#BFDBFE',
          300: '#93C5FD',
          400: '#60A5FA',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
        },

        // --- Status (reserved) ----------------------------------------------
        status: {
          good: '#10B981',
          warning: '#F59E0B',
          serious: '#F97316',
          critical: '#EF4444',
        },

        // --- Chart chrome ---------------------------------------------------
        grid: 'rgba(255, 255, 255, 0.05)',
        axis: 'rgba(255, 255, 255, 0.15)',
      },

      // Translucent hairline borders
      borderColor: {
        hairline: 'rgba(255, 255, 255, 0.08)',
        'hairline-strong': 'rgba(255, 255, 255, 0.16)',
      },

      backgroundImage: {
        'glow-accent': 'linear-gradient(135deg, #4F8CFF 0%, #8B5CF6 50%, #EC4899 100%)',
        'glow-subtle': 'linear-gradient(135deg, rgba(79, 140, 255, 0.18) 0%, rgba(139, 92, 246, 0.12) 100%)',
        'cosmic-wash':
          'radial-gradient(circle at 50% 0%, rgba(79, 140, 255, 0.14), transparent 50%), ' +
          'radial-gradient(circle at 85% 30%, rgba(139, 92, 246, 0.10), transparent 45%), ' +
          'radial-gradient(circle at 15% 70%, rgba(236, 72, 153, 0.08), transparent 45%)',
      },

      boxShadow: {
        glow: '0 0 25px rgba(79, 140, 255, 0.35), 0 0 0 1px rgba(79, 140, 255, 0.4)',
        'glow-sm': '0 0 15px rgba(79, 140, 255, 0.25), 0 0 0 1px rgba(79, 140, 255, 0.3)',
        'glow-magenta': '0 0 25px rgba(236, 72, 153, 0.35), 0 0 0 1px rgba(236, 72, 153, 0.4)',
        panel: '0 10px 30px -10px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.08)',
        'focus-ring': '0 0 0 2px #09090C, 0 0 0 4px #4F8CFF',
      },

      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        numeric: ['Inter', 'system-ui', 'sans-serif'],
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

      screens: {
        xs: '375px',
      },
    },
  },
  plugins: [],
};
