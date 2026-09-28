/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Keep semantic aliases for convenience
        'nwis-bg':      '#020617', // slate-950
        'nwis-panel':   '#0f172a', // slate-900
        'nwis-border':  '#1e293b', // slate-800
        'nwis-primary': '#0ea5e9', // sky-500
        'nwis-accent':  '#10b981', // emerald-500
        'nwis-warning': '#f59e0b', // amber-500
        'nwis-danger':  '#ef4444', // red-500
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out both',
        'slide-in': 'slideIn 0.25s ease-out both',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        slideIn: { from: { opacity: '0', transform: 'translateX(-8px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
      },
    },
  },
  plugins: [],
}
