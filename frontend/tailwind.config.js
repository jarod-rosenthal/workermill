/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0a0a0f',
        foreground: '#fafafa',
        card: {
          DEFAULT: '#111118',
          foreground: '#fafafa',
        },
        primary: {
          DEFAULT: '#00d9ff',
          foreground: '#0a0a0f',
        },
        secondary: {
          DEFAULT: '#1e1e2e',
          foreground: '#fafafa',
        },
        muted: {
          DEFAULT: '#27272a',
          foreground: '#a1a1aa',
        },
        accent: {
          DEFAULT: '#00ff88',
          foreground: '#0a0a0f',
        },
        destructive: {
          DEFAULT: '#ef4444',
          foreground: '#fafafa',
        },
        border: '#27272a',
        input: '#27272a',
        ring: '#00d9ff',
      },
    },
  },
  plugins: [],
}
