import { copyFileSync, mkdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vite';

import pkg from './package.json' with { type: 'json' };

const root = dirname(fileURLToPath(import.meta.url));
const sharedDist = resolve(root, '../shared/dist');
const bundledSharedDist = resolve(root, 'dist/shared/dist');

const dependencyNames = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
]);

const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

function isExternal(id: string): boolean {
  if (nodeBuiltins.has(id) || id.startsWith('node:')) return true;
  for (const name of dependencyNames) {
    if (id === name || id.startsWith(`${name}/`)) return true;
  }
  return false;
}

function bundledSharedSpecifier(filePath: string, moduleName: string): string {
  const target = resolve(bundledSharedDist, moduleName);
  let specifier = relative(dirname(resolve(filePath)), target).replaceAll('\\', '/');
  if (!specifier.startsWith('.')) specifier = `./${specifier}`;
  return `${specifier}.js`;
}

function copySharedDeclarations() {
  return {
    name: 'copy-shared-declarations',
    closeBundle() {
      mkdirSync(bundledSharedDist, { recursive: true });
      for (const moduleName of ['map-options', 'map-path']) {
        for (const extension of ['d.ts', 'd.ts.map']) {
          copyFileSync(
            resolve(sharedDist, `${moduleName}.${extension}`),
            resolve(bundledSharedDist, `${moduleName}.${extension}`),
          );
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [
    dts({
      include: ['src'],
      tsconfigPath: './tsconfig.json',
      beforeWriteFile(filePath, content) {
        const wasmIndexDeclaration = resolve(root, 'dist/wasm/index.d.ts');
        const wasmIndexDeclarationMap = `${wasmIndexDeclaration}.map`;
        if (filePath === wasmIndexDeclaration) {
          return {
            filePath: resolve(root, 'dist/wasm.d.ts'),
            content: content
              .replace("from './browser.js'", "from './wasm/browser.js'")
              .replace('index.d.ts.map', 'wasm.d.ts.map'),
          };
        }
        if (filePath === wasmIndexDeclarationMap) {
          return {
            filePath: resolve(root, 'dist/wasm.d.ts.map'),
            content: content
              .replace('"file":"index.d.ts"', '"file":"wasm.d.ts"')
              .replace('"../../src/wasm/index.ts"', '"../src/wasm/index.ts"'),
          };
        }
        return {
          content: content
            .replaceAll(
              '@postcss-go/shared/map-options',
              bundledSharedSpecifier(filePath, 'map-options'),
            )
            .replaceAll(
              '@postcss-go/shared/map-path',
              bundledSharedSpecifier(filePath, 'map-path'),
            ),
        };
      },
    }),
    copySharedDeclarations(),
  ],
  build: {
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    target: 'node18',
    lib: {
      entry: {
        index: resolve(root, 'src/index.ts'),
        service: resolve(root, 'src/service.ts'),
        cli: resolve(root, 'src/cli.ts'),
        wasm: resolve(root, 'src/wasm/index.ts'),
        'wasm/worker': resolve(root, 'src/wasm/worker.ts'),
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
