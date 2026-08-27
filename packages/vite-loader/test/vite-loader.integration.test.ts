import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AcceptedPlugin } from '@postcss-go/core';
import { afterEach, expect, test } from 'vitest';
import { build, createLogger, type Logger, type Plugin, type ResolvedConfig } from 'vite';

import postcssGoVitePlugin, { type PostcssGoVitePluginOptions } from '../src/index.js';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const temporaryDirectories: string[] = [];

interface OutputAsset {
  type: 'asset';
  fileName: string;
  source: string | Uint8Array;
}

interface OutputChunk {
  type: 'chunk';
  fileName: string;
  code: string;
}

type BuildOutput = OutputAsset | OutputChunk;

interface TransformCapture {
  result: { code: string; map: string | null } | null | undefined;
  watched: string[];
  emitted: Array<{ fileName?: string; source: string | Uint8Array }>;
  warnings: string[];
  thrown: unknown;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createProject(css = '.card { color: red; }\n', entry = 'input.css'): string {
  const directory = mkdtempSync(join(tmpdir(), 'postcss-go-vite-loader-'));
  temporaryDirectories.push(directory);
  writeFileSync(resolve(directory, 'index.js'), `import './${entry}';\n`);
  writeFileSync(resolve(directory, entry), css);
  return directory;
}

function createViteConfig(
  directory: string,
  overrides: Partial<ResolvedConfig> = {},
): ResolvedConfig {
  return {
    mode: 'production',
    command: 'build',
    root: directory,
    css: { devSourcemap: false },
    build: { sourcemap: true },
    ...overrides,
  } as ResolvedConfig;
}

async function transformCss(
  options: PostcssGoVitePluginOptions,
  content: string,
  file: string,
  viteConfigOverrides: Partial<ResolvedConfig> = {},
): Promise<TransformCapture> {
  const plugin = postcssGoVitePlugin(options);
  const directory = resolve(file, '..');
  const viteConfig = createViteConfig(directory, viteConfigOverrides);
  const configResolved = plugin.configResolved;
  if (typeof configResolved === 'function') {
    configResolved.call({} as never, viteConfig);
  } else if (configResolved && typeof configResolved.handler === 'function') {
    configResolved.handler.call({} as never, viteConfig);
  }

  const watched: string[] = [];
  const emitted: Array<{ fileName?: string; source: string | Uint8Array }> = [];
  const warnings: string[] = [];
  const transformHook = plugin.transform;
  if (typeof transformHook !== 'function') {
    throw new Error('Expected a Vite transform hook');
  }

  const context = {
    addWatchFile(target: string) {
      watched.push(target);
    },
    emitFile(asset: { type: 'asset'; fileName?: string; source: string | Uint8Array }) {
      emitted.push(asset);
      return 'asset-id';
    },
    warn(warning: { message: string }) {
      warnings.push(warning.message);
    },
    error(error: unknown): never {
      throw error;
    },
  };

  let result: TransformCapture['result'];
  let thrown: unknown;
  try {
    result = (await transformHook.call(
      context as never,
      content,
      file,
    )) as TransformCapture['result'];
  } catch (error) {
    thrown = error;
  }

  return { result, watched, emitted, warnings, thrown };
}

async function compile(
  directory: string,
  options: PostcssGoVitePluginOptions,
  extras: { logger?: Logger; plugins?: Plugin[]; sourcemap?: boolean } = {},
): Promise<BuildOutput[]> {
  const result = await build({
    root: directory,
    configFile: false,
    logLevel: 'silent',
    customLogger: extras.logger,
    plugins: [postcssGoVitePlugin(options), ...(extras.plugins ?? [])],
    build: {
      write: false,
      sourcemap: extras.sourcemap ?? true,
      cssMinify: false,
      rollupOptions: { input: resolve(directory, 'index.js') },
    },
  });
  const outputs = Array.isArray(result)
    ? result.flatMap((entry) => (entry as unknown as { output: BuildOutput[] }).output)
    : (result as unknown as { output: BuildOutput[] }).output;
  return outputs as BuildOutput[];
}

function outputText(output: BuildOutput): string {
  return output.type === 'chunk'
    ? output.code
    : typeof output.source === 'string'
      ? output.source
      : Buffer.from(output.source).toString('utf8');
}

function findOutput(outputs: BuildOutput[], suffix: string): BuildOutput {
  const output = outputs.find((entry) => entry.fileName.endsWith(suffix));
  if (!output) throw new Error(`Vite output did not contain ${suffix}`);
  return output;
}

test('processes CSS and forwards warnings, dependencies, assets, and source maps', async () => {
  const directory = createProject();
  const input = resolve(directory, 'input.css');
  const dependency = resolve(directory, 'tokens.css');
  const missingDependency = resolve(directory, 'future.css');
  writeFileSync(dependency, ':root { --brand: blue; }\n');

  const plugin: AcceptedPlugin = {
    postcssPlugin: 'vite-loader-contract',
    Once(root, { result }) {
      result.warn('contract warning', { node: root.first });
      result.messages.push({ type: 'dependency', file: dependency });
      result.messages.push({ type: 'build-dependency', file: dependency });
      result.messages.push({ type: 'missing-dependency', file: missingDependency });
      result.messages.push({ type: 'context-dependency', file: directory });
      result.messages.push({ type: 'dir-dependency', dir: directory, glob: '*.css' });
      result.messages.push({
        type: 'asset',
        file: 'postcss-go-asset.txt',
        content: Buffer.from('emitted by @postcss-go/vite-loader'),
      });
    },
    Declaration(declaration) {
      declaration.value = 'blue';
    },
  };

  const { result, watched, emitted, warnings } = await transformCss(
    { sourceMap: true, postcssOptions: { config: false, plugins: [plugin] } },
    '.card { color: red; }\n',
    input,
  );

  expect(result?.code).toContain('color: blue');
  expect(result?.code).not.toContain('sourceMappingURL=');
  expect(warnings.some((warning) => warning.includes('contract warning'))).toBe(true);
  expect(emitted).toEqual([
    expect.objectContaining({
      fileName: 'postcss-go-asset.txt',
      source: Buffer.from('emitted by @postcss-go/vite-loader'),
    }),
  ]);
  expect(watched).toEqual(expect.arrayContaining([dependency, missingDependency, directory]));

  const map = JSON.parse(result!.map as string) as { sources: string[] };
  expect(map.sources.some((source) => source.endsWith('input.css'))).toBe(true);

  const warningsFromBuild: string[] = [];
  const logger = createLogger('silent');
  logger.warn = (message) => warningsFromBuild.push(message);
  logger.warnOnce = logger.warn;
  const outputs = await compile(
    directory,
    { postcssOptions: { config: false, plugins: [plugin] } },
    { logger },
  );
  expect(outputText(findOutput(outputs, '.css'))).toContain('color: blue');
  expect(outputText(findOutput(outputs, 'postcss-go-asset.txt'))).toBe(
    'emitted by @postcss-go/vite-loader',
  );
  expect(warningsFromBuild.some((warning) => warning.includes('contract warning'))).toBe(true);
});

test('loads a config once and registers it as a watched dependency', async () => {
  const directory = createProject();
  const configFile = resolve(directory, 'postcss.config.cjs');
  writeFileSync(
    configFile,
    `let runs = 0;
module.exports = {
  plugins: [{
    postcssPlugin: 'config-contract',
    Once() { runs += 1; },
    Declaration(declaration) { declaration.value = String(runs); }
  }]
};
`,
  );
  const outputs = await compile(directory, {});
  const css = outputText(findOutput(outputs, '.css'));
  expect(css).toContain('color: 1');
  expect(css).not.toContain('color: 2');

  const { watched } = await transformCss(
    {},
    '.card { color: red; }\n',
    resolve(directory, 'input.css'),
  );
  expect(watched.map((file) => realpathSync(file))).toContain(realpathSync(configFile));
});

test('accepts async options and keeps from/to pinned to the Vite request', async () => {
  const directory = createProject();
  const input = resolve(directory, 'input.css');
  const seen: string[] = [];
  const plugin: AcceptedPlugin = {
    postcssPlugin: 'factory-contract',
    Declaration(declaration) {
      declaration.value = 'teal';
    },
  };

  const { result } = await transformCss(
    {
      sourceMap: false,
      async postcssOptions(api) {
        seen.push(api.mode, api.env, api.file, api.viteConfig.root, String(api.options.sourceMap));
        return {
          config: false,
          from: '/virtual/custom.css',
          to: '/virtual/custom.css',
          map: true,
          plugins: [plugin],
        };
      },
    },
    '.card { color: red; }\n',
    input,
    { build: { sourcemap: false } as ResolvedConfig['build'] },
  );

  expect(result?.code).toContain('color: teal');
  expect(result?.map).toBeNull();
  expect(seen).toEqual(['production', 'production', input, directory, 'false']);
});

test('accepts a synchronous postcssOptions factory', async () => {
  const directory = createProject('.factory { color: red; }\n');
  const input = resolve(directory, 'input.css');
  const seen: string[] = [];

  const { result } = await transformCss(
    {
      postcssOptions(api) {
        seen.push(api.mode, api.file);
        return {
          config: false,
          plugins: [
            {
              postcssPlugin: 'factory-contract',
              Declaration(declaration) {
                declaration.value = 'teal';
              },
            },
          ],
        };
      },
    },
    '.factory { color: red; }\n',
    input,
    {
      mode: 'development',
      command: 'serve',
      css: { devSourcemap: true } as ResolvedConfig['css'],
    },
  );

  expect(result?.code).toContain('color: teal');
  expect(seen[0]).toBe('development');
  expect(realpathSync(seen[1]!)).toBe(realpathSync(input));
});

test('preserves explicit Vite PostCSS configuration', async () => {
  const plugin = postcssGoVitePlugin({ postcssOptions: { config: false } });
  const configHook = plugin.config;
  if (typeof configHook !== 'function') throw new Error('Expected a Vite config hook');

  expect(await configHook.call({} as never, { css: { postcss: './custom' } }, {} as never)).toBe(
    undefined,
  );
  expect(await configHook.call({} as never, {}, {} as never)).toEqual({
    css: { postcss: { plugins: [] } },
  });
});

test('ignores JavaScript, Sass, and virtual modules without invoking options', async () => {
  let calls = 0;
  const plugin = postcssGoVitePlugin({
    postcssOptions() {
      calls += 1;
      return { config: false };
    },
  });
  const transformHook = plugin.transform;
  if (typeof transformHook !== 'function') throw new Error('Expected a Vite transform hook');

  const context = {} as never;
  expect(await transformHook.call(context, 'export default 1', '/input.js')).toBeNull();
  expect(await transformHook.call(context, '$x: 1;', '/input.scss')).toBeNull();
  expect(await transformHook.call(context, '.x{}', '\0virtual.css')).toBeNull();
  expect(calls).toBe(0);
});

test('processes .pcss and .postcss requests and strips query strings', async () => {
  const directory = createProject('.pcss { color: red; }\n', 'styles.pcss');
  const pcssFile = resolve(directory, 'styles.pcss');
  const postcssFile = resolve(directory, 'styles.postcss');
  writeFileSync(postcssFile, '.postcss { color: red; }\n');
  writeFileSync(
    resolve(directory, 'index.js'),
    `import './styles.pcss';\nimport './styles.postcss';\n`,
  );

  const plugin: AcceptedPlugin = {
    postcssPlugin: 'extension-contract',
    Declaration(declaration) {
      declaration.value = 'green';
    },
  };

  const pcss = await transformCss(
    { postcssOptions: { config: false, plugins: [plugin] } },
    '.pcss { color: red; }\n',
    pcssFile,
  );
  const postcss = await transformCss(
    { postcssOptions: { config: false, plugins: [plugin] } },
    '.postcss { color: red; }\n',
    `${postcssFile}?inline`,
  );

  expect(pcss.result?.code).toContain('color: green');
  expect(postcss.result?.code).toContain('color: green');
});

test('disables config map output when Vite source maps are off', async () => {
  const directory = createProject('.mapped { color: red; }\n');
  writeFileSync(
    resolve(directory, 'postcss.config.cjs'),
    `module.exports = { map: true, plugins: [] };\n`,
  );

  const { result } = await transformCss(
    { sourceMap: false, postcssOptions: {} },
    '.mapped { color: red; }\n',
    resolve(directory, 'input.css'),
    { build: { sourcemap: false } as ResolvedConfig['build'] },
  );

  expect(result?.code).toContain('color: red');
  expect(result?.code).not.toContain('sourceMappingURL=');
  expect(result?.map).toBeNull();
});

test('reports syntax errors with Vite source locations', async () => {
  const directory = createProject('.broken { color: red;\n');
  await expect(
    compile(directory, {
      postcssOptions: {
        config: false,
        plugins: [{ postcssPlugin: 'force-parse', Once() {} }],
      },
    }),
  ).rejects.toMatchObject({
    errors: [
      expect.objectContaining({
        loc: expect.objectContaining({ line: 1, column: 0 }),
        message: expect.stringContaining('Unclosed block'),
      }),
    ],
  });
});

test('rejects invalid plugins and missing explicit configs', async () => {
  const directory = createProject();
  await expect(
    compile(directory, { postcssOptions: { config: false, plugins: {} as never } }),
  ).rejects.toThrow('plugins to be an array');
  await expect(
    compile(directory, { postcssOptions: { config: 'missing.config.cjs' } }),
  ).rejects.toThrow('No postcss-go config found');
});

test('package stays free of postcss and postcss-loader', () => {
  const pkg = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  for (const section of [pkg.dependencies, pkg.peerDependencies, pkg.devDependencies]) {
    expect(section?.postcss).toBeUndefined();
    expect(section?.['postcss-loader']).toBeUndefined();
  }
});
