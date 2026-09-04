import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { CssSyntaxError, type AcceptedPlugin } from '@postcss-go/core';
import { afterEach, expect, test } from 'vitest';

import loader, { type PostcssGoLoaderOptions } from '../src/index.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

type LoaderResult = {
  error: Error | null;
  css?: string;
  map?: Record<string, unknown> | undefined;
  meta?: { ast?: { type?: string; root?: { type?: string } } };
};

type MockContext = {
  resourcePath: string;
  context: string | null;
  rootContext: string;
  mode?: string;
  sourceMap?: boolean;
  cacheable: () => void;
  getOptions: () => PostcssGoLoaderOptions;
  async: () => (
    error: Error | null,
    css?: string,
    map?: Record<string, unknown>,
    meta?: LoaderResult['meta'],
  ) => void;
  addDependency: (file: string) => void;
  addBuildDependency: (file: string) => void;
  addMissingDependency: (file: string) => void;
  addContextDependency: (file: string) => void;
  emitWarning: (warning: Error) => void;
  emitFile: (
    file: string,
    content: string | Buffer,
    sourceMap?: string,
    info?: Record<string, unknown>,
  ) => void;
  dependencies: string[];
  buildDependencies: string[];
  missingDependencies: string[];
  contextDependencies: string[];
  warnings: Error[];
  assets: Array<{
    file: string;
    content: string | Buffer;
    sourceMap?: string;
    info?: Record<string, unknown>;
  }>;
};

function createProject(): string {
  const directory = mkdtempSync(join(tmpdir(), 'postcss-go-webpack-loader-unit-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createContext(
  directory: string,
  options: PostcssGoLoaderOptions,
  overrides: Partial<MockContext> = {},
): MockContext {
  const resourcePath = resolve(directory, 'input.css');
  const context: MockContext = {
    resourcePath,
    context: directory,
    rootContext: directory,
    mode: 'development',
    sourceMap: true,
    cacheable() {},
    getOptions: () => options,
    async() {
      throw new Error('async() should be replaced by runLoader');
    },
    dependencies: [],
    buildDependencies: [],
    missingDependencies: [],
    contextDependencies: [],
    warnings: [],
    assets: [],
    addDependency(file) {
      this.dependencies.push(file);
    },
    addBuildDependency(file) {
      this.buildDependencies.push(file);
    },
    addMissingDependency(file) {
      this.missingDependencies.push(file);
    },
    addContextDependency(file) {
      this.contextDependencies.push(file);
    },
    emitWarning(warning) {
      this.warnings.push(warning);
    },
    emitFile(file, content, sourceMap, info) {
      this.assets.push({ file, content, sourceMap, info });
    },
    ...overrides,
  };
  return context;
}

function runLoader(
  context: MockContext,
  content: string | Buffer,
  sourceMap?: string | object,
): Promise<LoaderResult> {
  return new Promise((resolveResult) => {
    context.async = () => (error, css, map, meta) => {
      resolveResult({ error, css, map, meta });
    };
    loader.call(context as never, content as never, sourceMap as never);
  });
}

test('rejects non-array plugins and missing explicit configs', async () => {
  const directory = createProject();
  writeFileSync(resolve(directory, 'input.css'), '.x { color: red; }\n');

  const invalid = await runLoader(
    createContext(directory, {
      postcssOptions: { config: false, plugins: { autoprefixer: {} } as never },
    }),
    '.x { color: red; }\n',
  );
  expect(invalid.error?.message).toMatch(/plugins to be an array/);

  const missing = await runLoader(
    createContext(directory, {
      postcssOptions: { config: 'missing.config.cjs' },
    }),
    '.x { color: red; }\n',
  );
  expect(missing.error?.message).toMatch(/No postcss-go config found/);
});

test('accepts async postcssOptions and exposes webpackLoaderContext', async () => {
  const directory = createProject();
  writeFileSync(resolve(directory, 'input.css'), '.factory { color: red; }\n');
  const seen: unknown[] = [];

  const result = await runLoader(
    createContext(directory, {
      sourceMap: true,
      async postcssOptions(api) {
        seen.push(api.mode, api.env, api.file, api.webpackLoaderContext, api.options.sourceMap);
        return {
          config: false,
          plugins: [
            {
              postcssPlugin: 'async-factory',
              Declaration(declaration) {
                declaration.value = 'navy';
              },
            },
          ],
        };
      },
    }),
    '.factory { color: red; }\n',
  );

  expect(result.error).toBeNull();
  expect(result.css).toContain('color: navy');
  expect(seen[0]).toBe('development');
  expect(seen[1]).toBe('development');
  expect(String(seen[2])).toContain('input.css');
  expect(seen[3]).toMatchObject({ resourcePath: expect.stringContaining('input.css') });
  expect(seen[4]).toBe(true);
});

test('forwards build/context dependencies, asset metadata, and plain warnings', async () => {
  const directory = createProject();
  const dependency = resolve(directory, 'tokens.css');
  const missing = resolve(directory, 'future.css');
  writeFileSync(resolve(directory, 'input.css'), '.card { color: red; }\n');
  writeFileSync(dependency, ':root {}\n');

  const plugin: AcceptedPlugin = {
    postcssPlugin: 'message-contract',
    Once(root, { result }) {
      result.warn('plain warning');
      result.warn('node warning', { node: root.first });
      result.messages.push({ type: 'dependency', file: dependency });
      result.messages.push({ type: 'build-dependency', file: dependency });
      result.messages.push({ type: 'missing-dependency', file: missing });
      result.messages.push({ type: 'context-dependency', file: directory });
      result.messages.push({ type: 'dir-dependency', dir: directory, glob: '*.css' });
      result.messages.push({ type: 'dependency' } as never);
      result.messages.push({ type: 'build-dependency' } as never);
      result.messages.push({ type: 'missing-dependency' } as never);
      result.messages.push({ type: 'context-dependency' } as never);
      result.messages.push({ type: 'dir-dependency' } as never);
      result.messages.push({
        type: 'asset',
        file: 'meta.txt',
        content: Buffer.from('asset-body'),
        sourceMap: { version: 3, sources: ['meta.txt'], mappings: '' },
        info: { immutable: true },
      });
      result.messages.push({
        type: 'asset',
        file: 'string-map.txt',
        content: 'text',
        sourceMap: '{"version":3}',
      });
      result.messages.push({ type: 'asset', file: 'skipped.txt' } as never);
      void root;
    },
  };

  const context = createContext(directory, {
    sourceMap: true,
    postcssOptions: { config: false, plugins: [plugin] },
  });
  const result = await runLoader(context, '.card { color: red; }\n');

  expect(result.error).toBeNull();
  expect(context.warnings.some((warning) => warning.message.includes('plain warning'))).toBe(true);
  expect(context.warnings.some((warning) => warning.message.includes('Code:'))).toBe(true);
  expect(context.dependencies).toContain(dependency);
  expect(context.buildDependencies).toContain(dependency);
  expect(context.missingDependencies).toContain(missing);
  expect(context.contextDependencies).toEqual(expect.arrayContaining([directory, directory]));
  expect(context.assets).toEqual([
    expect.objectContaining({
      file: 'meta.txt',
      content: Buffer.from('asset-body'),
      sourceMap: JSON.stringify({ version: 3, sources: ['meta.txt'], mappings: '' }),
      info: { immutable: true },
    }),
    expect.objectContaining({
      file: 'string-map.txt',
      content: 'text',
      sourceMap: '{"version":3}',
    }),
  ]);
});

test('normalizes string previous maps with XSSI prefix and null context', async () => {
  const directory = createProject();
  writeFileSync(resolve(directory, 'input.css'), '.mapped { color: purple; }\n');
  const previous = `)]}'\n${JSON.stringify({
    version: 3,
    file: 'ignored.css',
    sourceRoot: directory,
    sources: ['original.scss'],
    mappings: 'AAAA',
    sourcesContent: ['$c: purple;'],
  })}`;

  const plugin: AcceptedPlugin = {
    postcssPlugin: 'prev-map',
    Declaration(declaration) {
      declaration.value = 'orange';
    },
  };

  const context = createContext(
    directory,
    {
      sourceMap: true,
      postcssOptions: { config: false, map: { sourcesContent: true }, plugins: [plugin] },
    },
    { context: null },
  );
  const result = await runLoader(context, '.mapped { color: purple; }\n', previous);

  expect(result.error).toBeNull();
  expect(result.css).toContain('color: orange');
  expect(result.map?.sources).toEqual(
    expect.arrayContaining([expect.stringContaining('original.scss')]),
  );
});

test('merges config plugins with direct plugins and coerces map: true', async () => {
  const directory = createProject();
  writeFileSync(resolve(directory, 'input.css'), '.merged { color: red; }\n');
  writeFileSync(
    resolve(directory, 'postcss.config.cjs'),
    `module.exports = {
  map: true,
  plugins: [{
    postcssPlugin: 'config-plugin',
    Declaration(declaration) { declaration.value = 'green'; }
  }]
};
`,
  );

  const direct: AcceptedPlugin = {
    postcssPlugin: 'direct-plugin',
    Rule(rule) {
      rule.selector = '.merged-direct';
    },
  };

  const result = await runLoader(
    createContext(directory, {
      sourceMap: true,
      postcssOptions: { plugins: [direct] },
    }),
    '.merged { color: red; }\n',
  );

  expect(result.error).toBeNull();
  expect(result.css).toContain('.merged-direct');
  expect(result.css).toContain('color: green');
  expect(result.css).not.toContain('sourceMappingURL=');
  expect(result.map).toMatchObject({ version: 3 });
});

test('formats CssSyntaxError details and non-error throws', async () => {
  const directory = createProject();
  writeFileSync(resolve(directory, 'input.css'), '.broken { color: red; }\n');

  const syntaxPlugin: AcceptedPlugin = {
    postcssPlugin: 'syntax-error-contract',
    Once() {
      throw new CssSyntaxError('broken css', {
        plugin: 'syntax-error-contract',
        file: resolve(directory, 'input.css'),
        line: 1,
        column: 2,
        source: '.broken { color: red; }\n',
      });
    },
  };
  const context = createContext(directory, {
    postcssOptions: { config: false, plugins: [syntaxPlugin] },
  });
  const syntax = await runLoader(context, '.broken { color: red; }\n');
  expect(syntax.error?.message).toContain('SyntaxError');
  expect(syntax.error?.message).toContain('syntax-error-contract');
  expect(syntax.error?.message).toContain('input.css');
  expect(context.dependencies).toContain(resolve(directory, 'input.css'));

  const runtimePlugin: AcceptedPlugin = {
    postcssPlugin: 'runtime-error-contract',
    Once() {
      throw new Error('unexpected runtime failure');
    },
  };
  const runtime = await runLoader(
    createContext(directory, {
      postcssOptions: { config: false, plugins: [runtimePlugin] },
    }),
    '.broken { color: red; }\n',
  );
  expect(runtime.error?.message).toBe('unexpected runtime failure');

  const stringThrow: AcceptedPlugin = {
    postcssPlugin: 'string-throw',
    Once() {
      throw 'plain failure';
    },
  };
  const plain = await runLoader(
    createContext(directory, {
      postcssOptions: { config: false, plugins: [stringThrow] },
    }),
    '.broken { color: red; }\n',
  );
  expect(plain.error?.message).toBe('plain failure');
});

test('preserves absolute source URLs from previous maps', async () => {
  const directory = createProject();
  const css = '.abs { color: red; }\n';
  writeFileSync(resolve(directory, 'input.css'), css);

  const { SourceMapGenerator } = await import('source-map-js');
  const generator = new SourceMapGenerator({ file: 'input.css' });
  generator.addMapping({
    generated: { line: 1, column: 0 },
    original: { line: 1, column: 0 },
    source: 'https://cdn.example/a.css',
  });
  generator.setSourceContent('https://cdn.example/a.css', css);

  const result = await runLoader(
    createContext(directory, {
      sourceMap: true,
      postcssOptions: {
        config: false,
        plugins: [
          {
            postcssPlugin: 'identity',
            Once() {},
          },
        ],
      },
    }),
    css,
    generator.toJSON(),
  );

  expect(result.error).toBeNull();
  expect(result.map?.sources).toEqual(expect.arrayContaining(['https://cdn.example/a.css']));
});

test('uses loaderContext.sourceMap when option is omitted and accepts Buffer input', async () => {
  const directory = createProject();
  writeFileSync(resolve(directory, 'input.css'), '.buf { color: red; }\n');

  const withMaps = await runLoader(
    createContext(
      directory,
      {
        postcssOptions: {
          config: false,
          plugins: [
            {
              postcssPlugin: 'buffer-contract',
              Declaration(declaration) {
                declaration.value = 'blue';
              },
            },
          ],
        },
      },
      { sourceMap: true },
    ),
    Buffer.from('.buf { color: red; }\n'),
  );
  expect(withMaps.error).toBeNull();
  expect(withMaps.css).toContain('color: blue');
  expect(withMaps.map).toMatchObject({ version: 3 });

  const withoutMaps = await runLoader(
    createContext(
      directory,
      {
        postcssOptions: {
          config: false,
          plugins: [],
        },
      },
      { sourceMap: false },
    ),
    '.buf { color: red; }\n',
  );
  expect(withoutMaps.error).toBeNull();
  expect(withoutMaps.map).toBeUndefined();
});

test('falls back to NODE_ENV when loader mode is unset', async () => {
  const directory = createProject();
  writeFileSync(resolve(directory, 'input.css'), '.env { color: red; }\n');
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  try {
    const seen: string[] = [];
    const result = await runLoader(
      createContext(
        directory,
        {
          postcssOptions(api) {
            seen.push(api.mode);
            return {
              config: false,
              plugins: [
                {
                  postcssPlugin: 'mode-contract',
                  Declaration(declaration) {
                    declaration.value = 'black';
                  },
                },
              ],
            };
          },
        },
        { mode: undefined },
      ),
      '.env { color: red; }\n',
    );
    expect(result.error).toBeNull();
    expect(seen[0]).toBe('production');
    expect(result.css).toContain('color: black');
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
