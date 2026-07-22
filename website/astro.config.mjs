/* global process */

import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'static',
  site: 'https://eryue0220.github.io',
  base: process.env.GITHUB_ACTIONS === 'true' ? '/postcss-go' : '/',
  vite: {
    plugins: [tailwindcss()],
  },
});
