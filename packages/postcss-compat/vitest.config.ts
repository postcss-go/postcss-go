import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
  coverage: {
    provider: 'v8',
    all: true,
    include: ['bridge-client.cjs', 'register.cjs'],
    exclude: ['**/src/**', '**/dist/**', '**/test/**'],
    excludeAfterRemap: true,
    reporter: ['text', 'html'],
    thresholds: {
      statements: 95,
      branches: 75,
      functions: 100,
      lines: 95,
    },
  },
});
