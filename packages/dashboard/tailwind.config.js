/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Institutional Slate Grayscale
        slate: {
          950: '#020617',
          900: '#0f172a',
          800: '#1e293b',
          700: '#334155',
          600: '#475569',
          500: '#64748b',
          400: '#94a3b8',
          300: '#cbd5e1',
          200: '#e2e8f0',
          100: '#f1f5f9',
          50: '#f8fafc',
        },
        // Semantic Status
        status: {
          success: '#10b981',
          warning: '#f59e0b',
          critical: '#ef4444',
          info: '#3b82f6',
        },
        // Legacy compatibility
        aegix: {
          cyan: '#3b82f6',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'SF Mono', 'Consolas', 'monospace'],
      },
      fontSize: {
        'xs': ['11px', { lineHeight: '16px' }],
        'sm': ['12px', { lineHeight: '18px' }],
        'base': ['13px', { lineHeight: '20px' }],
        'lg': ['14px', { lineHeight: '22px' }],
        'xl': ['16px', { lineHeight: '24px' }],
        '2xl': ['20px', { lineHeight: '28px' }],
      },
      borderRadius: {
        'none': '0',
        'sm': '2px',
        'DEFAULT': '2px',
        'md': '2px',
        'lg': '2px',
        'xl': '2px',
      },
      spacing: {
        'header': '48px',
        'sidebar': '240px',
        'console': '180px',
      },
      boxShadow: {
        'sm': '0 1px 2px rgba(0, 0, 0, 0.3)',
        'DEFAULT': '0 2px 4px rgba(0, 0, 0, 0.2)',
        'md': '0 4px 8px rgba(0, 0, 0, 0.25)',
        'lg': '0 8px 16px rgba(0, 0, 0, 0.3)',
        'inner': 'inset 0 1px 2px rgba(0, 0, 0, 0.2)',
      },
      animation: {
        'spin-slow': 'spin 2s linear infinite',
        'pulse-subtle': 'pulse 3s ease-in-out infinite',
        'reveal': 'reveal 0.3s ease-out',
      },
      keyframes: {
        reveal: {
          '0%': { opacity: '0.5', filter: 'blur(2px)' },
          '100%': { opacity: '1', filter: 'blur(0)' },
        },
      },
    },
  },
  plugins: [],
};
