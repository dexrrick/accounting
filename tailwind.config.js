/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Figtree', 'Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        ynab: {
          navy: '#152A4A',
          darknavy: '#0F1E36',
          blue: '#2A7DE1',
          blueHover: '#2369C0',
          teal: '#00838F',
          green: '#16A34A',
          amber: '#D97706',
          red: '#DC2626',
          // YNAB Signature Dark Theme Palette
          darkBg: '#131A29',
          darkHeader: '#0F1626',
          darkSurface: '#1C2538',
          darkSurfaceElevated: '#242F46',
          darkInput: '#111827',
          darkBorder: '#2B374E',
          darkBorderSubtle: '#212A3D',
        }
      }
    },
  },
  plugins: [],
}

