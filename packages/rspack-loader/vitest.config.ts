import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 15000,
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.ts'],
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        statements: 90,
        branches: 75,
        functions: 90,
        lines: 90,
      },
    },
  },
});
