import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      all: true,
      include: ['bridge-client.cjs', 'register.cjs'],
      exclude: ['**/src/**', '**/dist/**', '**/test/**'],
      excludeAfterRemap: true,
      reporter: ['text', 'html', ['lcov', { projectRoot: repoRoot }]],
      thresholds: {
        statements: 95,
        branches: 75,
        functions: 100,
        lines: 95,
      },
    },
  },
});
