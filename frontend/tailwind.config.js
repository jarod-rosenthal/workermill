/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '***REMOVED***0a0a0f',
        foreground: '***REMOVED***fafafa',
        card: {
          DEFAULT: '***REMOVED***111118',
          foreground: '***REMOVED***fafafa',
        },
        primary: {
          DEFAULT: '***REMOVED***00d9ff',
          foreground: '***REMOVED***0a0a0f',
        },
        secondary: {
          DEFAULT: '***REMOVED***1e1e2e',
          foreground: '***REMOVED***fafafa',
        },
        muted: {
          DEFAULT: '***REMOVED***27272a',
          foreground: '***REMOVED***a1a1aa',
        },
        accent: {
          DEFAULT: '***REMOVED***00ff88',
          foreground: '***REMOVED***0a0a0f',
        },
        destructive: {
          DEFAULT: '***REMOVED***ef4444',
          foreground: '***REMOVED***fafafa',
        },
        border: '***REMOVED***27272a',
        input: '***REMOVED***27272a',
        ring: '***REMOVED***00d9ff',
      },
    },
  },
  plugins: [],
}
