/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', 'serif'],
        body: ['var(--font-body)', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      colors: {
        obsidian: {
          50: '#f2f2f0',
          100: '#e4e3df',
          200: '#c9c7be',
          300: '#aeab9d',
          400: '#938f7c',
          500: '#78735b',
          600: '#5e5a47',
          700: '#454133',
          800: '#2b2820',
          900: '#141210',
          950: '#0a0908',
        },
        amber: {
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
        },
        jade: {
          400: '#4ade80',
          500: '#22c55e',
        },
        crimson: {
          400: '#f87171',
          500: '#ef4444',
        },
      },
      animation: {
        'fade-up': 'fadeUp 0.5s ease forwards',
      },
      keyframes: {
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
