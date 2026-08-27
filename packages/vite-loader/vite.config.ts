import { builtinModules } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

export default defineConfig({
  plugins: [
    dts({
      include: ['src'],
      tsconfigPath: './tsconfig.build.json',
    }),
  ],
  build: {
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    target: 'node18',
    lib: {
      entry: resolve(root, 'src/index.ts'),
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
    },
    rollupOptions: {
      external: (id) =>
        id === '@postcss-go/core' ||
        id.startsWith('@postcss-go/core/') ||
        id === 'vite' ||
        nodeBuiltins.has(id) ||
        id.startsWith('node:'),
      output: {
        exports: 'default',
      },
    },
  },
});
