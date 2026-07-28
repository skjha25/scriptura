/**
 * Tailwind theme — single source of truth for Scriptura's visual language.
 * Ultra-Eye-Catching AI Dark Mode Theme with Aurora Ambient Mesh & Gen-Z Micro-Animations.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx}', './public/index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        void: {
          DEFAULT: '#09090D',
          soft: '#0E0E14',
        },
        panel: {
          DEFAULT: '#111118',
          raised: '#181824',
          sunken: '#0B0B10',
        },

        ink: {
          DEFAULT: '#FFFFFF',
          secondary: '#A1A1AA',
          muted: '#71717A',
          faint: '#52525B',
        },

        accent: {
          DEFAULT: '#3B82F6',
          bright: '#60A5FA',
          deep: '#2563EB',
          violet: '#8B5CF6',
          magenta: '#EC4899',
          cyan: '#06B6D4',
        },

        series: {
          1: '#3B82F6',
          2: '#F97316',
          3: '#10B981',
          4: '#F59E0B',
          5: '#EC4899',
          6: '#06B6D4',
          7: '#8B5CF6',
          8: '#EF4444',
        },

        sequential: {
          100: '#DBEAFE',
          200: '#BFDBFE',
          300: '#93C5FD',
          400: '#60A5FA',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
        },

        status: {
          good: '#10B981',
          warning: '#F59E0B',
          serious: '#F97316',
          critical: '#EF4444',
        },

        grid: 'rgba(255, 255, 255, 0.05)',
        axis: 'rgba(255, 255, 255, 0.15)',
      },

      borderColor: {
        hairline: 'rgba(255, 255, 255, 0.09)',
        'hairline-strong': 'rgba(255, 255, 255, 0.18)',
      },

      backgroundImage: {
        'glow-accent': 'linear-gradient(135deg, #3B82F6 0%, #8B5CF6 50%, #EC4899 100%)',
        'glow-subtle': 'linear-gradient(135deg, rgba(59, 130, 246, 0.16) 0%, rgba(139, 92, 246, 0.10) 100%)',
        'cosmic-wash':
          'radial-gradient(circle at 50% -20%, rgba(59, 130, 246, 0.22), transparent 70%), ' +
          'radial-gradient(circle at 85% 25%, rgba(139, 92, 246, 0.16), transparent 55%), ' +
          'radial-gradient(circle at 15% 75%, rgba(236, 72, 153, 0.12), transparent 55%)',
      },

      boxShadow: {
        glow: '0 0 25px rgba(59, 130, 246, 0.35), 0 0 0 1px rgba(59, 130, 246, 0.4)',
        'glow-sm': '0 0 15px rgba(59, 130, 246, 0.25), 0 0 0 1px rgba(59, 130, 246, 0.3)',
        'glow-magenta': '0 0 25px rgba(236, 72, 153, 0.35), 0 0 0 1px rgba(236, 72, 153, 0.4)',
        panel: '0 12px 35px -10px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.08)',
        'focus-ring': '0 0 0 2px #09090D, 0 0 0 4px #3B82F6',
      },

      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        numeric: ['Inter', 'system-ui', 'sans-serif'],
      },

      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-4px)' },
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
        'fade-in-up': 'fade-in-up 300ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        float: 'float 3s ease-in-out infinite',
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
