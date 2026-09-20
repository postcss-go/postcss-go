import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 15000,
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.ts'],
      reporter: ['text', 'html', ['lcov', { projectRoot: repoRoot }]],
      thresholds: {
        statements: 90,
        branches: 75,
        functions: 90,
        lines: 90,
      },
    },
  },
});
