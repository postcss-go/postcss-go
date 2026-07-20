import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 10000,
    include: ['test/*.ts'],
  },
  coverage: {
    provider: 'v8',
    all: true,
    include: ['lib/**/*.js'],
    exclude: ['index.js', 'scripts/**', 'test/**'],
    excludeAfterRemap: true,
    reporter: ['text', 'html'],
    thresholds: {
      statements: 85,
      branches: 70,
      functions: 90,
      lines: 85,
    },
  },
});
