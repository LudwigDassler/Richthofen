import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/context/**/*.{js,ts,jsx,tsx,mdx}',
    './src/lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          app: '#FAFAFA',
          panel: '#FFFFFF',
          darkApp: '#09090B',
          darkPanel: '#111113',
        },
        hairline: {
          light: '#E4E4E7',
          dark: '#27272A',
        },
        graphite: {
          50: '#FAFAFA',
          100: '#F4F4F5',
          200: '#E4E4E7',
          300: '#D4D4D8',
          400: '#A1A1AA',
          500: '#71717A',
          600: '#52525B',
          700: '#3F3F46',
          800: '#27272A',
          900: '#18181B',
          950: '#09090B',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'Cascadia Mono',
          'Consolas',
          'ui-monospace',
          'SFMono-Regular',
          'monospace',
        ],
      },
      boxShadow: {
        hairline: '0 1px 2px 0 rgba(9, 9, 11, 0.04)',
      },
    },
  },
  plugins: [],
};

export default config;
