import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
    include: ['test/**/*.test.ts'],
    exclude: ['test/e2e/**'],
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts', 'src/wasm/index.ts', 'src/plugin-types.ts', 'src/shims.d.ts'],
      excludeAfterRemap: true,
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
