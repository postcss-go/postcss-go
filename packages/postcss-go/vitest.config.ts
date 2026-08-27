import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts', 'src/wasm/index.ts', 'src/plugin-types.ts', 'src/shims.d.ts'],
      excludeAfterRemap: true,
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
