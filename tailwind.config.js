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
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        workspace: {
          canvas: 'rgb(var(--workspace-canvas) / <alpha-value>)',
          panel: 'rgb(var(--workspace-panel) / <alpha-value>)',
          raised: 'rgb(var(--workspace-raised) / <alpha-value>)',
          input: 'rgb(var(--workspace-input) / <alpha-value>)',
          border: 'rgb(var(--workspace-border) / <alpha-value>)',
          'border-muted': 'rgb(var(--workspace-border-muted) / <alpha-value>)',
          text: 'rgb(var(--workspace-text) / <alpha-value>)',
          secondary: 'rgb(var(--workspace-secondary) / <alpha-value>)',
          muted: 'rgb(var(--workspace-muted) / <alpha-value>)',
          accent: 'rgb(var(--workspace-accent) / <alpha-value>)',
          'accent-text': 'rgb(var(--workspace-accent-text) / <alpha-value>)',
          'accent-hover': 'rgb(var(--workspace-accent-hover) / <alpha-value>)',
          hover: 'rgb(var(--workspace-hover) / <alpha-value>)',
        },
        ynab: {
          navy: '#152A4A',
          darknavy: '#0F1E36',
          blue: '#5E6AD2',
          blueHover: '#505CB9',
          teal: '#00838F',
          green: '#16A34A',
          amber: '#D97706',
          red: '#DC2626',
          darkBg: '#08090A',
          darkHeader: '#08090A',
          darkSurface: '#0F1011',
          darkSurfaceElevated: '#191A1B',
          darkInput: '#191A1B',
          darkBorder: '#23252A',
          darkBorderSubtle: '#18191B',
        },
      },
    },
  },
  plugins: [],
}
