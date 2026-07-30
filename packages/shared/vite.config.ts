import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    dts({
      include: ['src'],
      tsconfigPath: './tsconfig.json',
    }),
  ],
  build: {
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    lib: {
      entry: {
        index: resolve(root, 'src/index.ts'),
        'map-options': resolve(root, 'src/map-options.ts'),
        'map-path': resolve(root, 'src/map-path.ts'),
      },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => (format === 'es' ? `${entryName}.js` : `${entryName}.cjs`),
    },
    rollupOptions: {
      output: {
        exports: 'named',
      },
    },
  },
});
