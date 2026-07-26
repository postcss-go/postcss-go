import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 10000,
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts', 'src/cli.ts', 'src/browser.ts', 'src/shims.d.ts'],
      excludeAfterRemap: true,
      reporter: ['text', 'html'],
      thresholds: {
        statements: 90,
        branches: 75,
        functions: 90,
        lines: 90,
      },
    },
  },
});
