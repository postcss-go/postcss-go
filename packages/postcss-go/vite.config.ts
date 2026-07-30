import { builtinModules } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vite';

import pkg from './package.json' with { type: 'json' };

const root = dirname(fileURLToPath(import.meta.url));

const dependencyNames = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
]);

const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

function isExternal(id: string): boolean {
  if (nodeBuiltins.has(id) || id.startsWith('node:')) return true;
  for (const name of dependencyNames) {
    if (id === name || id.startsWith(`${name}/`)) return true;
  }
  return false;
}

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
    target: 'node18',
    lib: {
      entry: {
        index: resolve(root, 'src/index.ts'),
        browser: resolve(root, 'src/browser.ts'),
        service: resolve(root, 'src/service.ts'),
        cli: resolve(root, 'src/cli.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: isExternal,
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: '[name].js',
      },
    },
  },
});
