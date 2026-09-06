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
        sans: ['Figtree', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        ynab: {
          navy: '#152A4A',
          darknavy: '#0F1E36',
          blue: '#2A7DE1',
          teal: '#00838F',
          green: '#16A34A',
          amber: '#D97706',
          red: '#DC2626',
        }
      }
    },
  },
  plugins: [],
}

