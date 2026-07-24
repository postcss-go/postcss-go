import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{astro,html,js,ts,jsx,tsx,md,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0a0b0d',
        paper: '#f5f5f0',
        acid: '#c8ff3d',
        violet: '#9676ff',
      },
      fontFamily: {
        sans: ['Arial', 'Helvetica Neue', 'sans-serif'],
        mono: ['SFMono-Regular', 'Consolas', 'Liberation Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
