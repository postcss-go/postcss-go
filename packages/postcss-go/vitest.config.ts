import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
  coverage: {
    provider: 'v8',
    all: true,
    include: ['src/**/*.ts'],
    exclude: ['src/types.ts'],
    excludeAfterRemap: true,
    reporter: ['text', 'html'],
    thresholds: {
      statements: 90,
      branches: 75,
      functions: 90,
      lines: 90,
    },
  },
});
