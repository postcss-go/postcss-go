import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AcceptedPlugin } from '@postcss-go/core';
import { afterEach, expect, test } from 'vitest';
import webpack, { type Configuration, type Stats } from 'webpack';

const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const webpackLoader = resolve(packageRoot, 'dist/index.cjs');
const cssLoader = require.resolve('css-loader');
const captureLoader = fileURLToPath(new URL('./fixtures/capture-loader.cjs', import.meta.url));
const previousMapLoader = fileURLToPath(
  new URL('./fixtures/previous-map-loader.cjs', import.meta.url),
);
const temporaryDirectories: string[] = [];

type Capture = {
  css: string;
  map: null | {
    version?: number;
    sources?: string[];
    sourcesContent?: Array<string | null>;
  };
  ast: null | {
    type?: string;
    version?: string;
    rootType?: string;
    css?: string;
  };
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createProject(): string {
  const directory = mkdtempSync(join(tmpdir(), 'postcss-go-webpack-loader-'));
  temporaryDirectories.push(directory);
  return directory;
}

function compile(config: Configuration): Promise<Stats> {
  return new Promise((resolveCompilation, rejectCompilation) => {
    const compiler = webpack(config);
    compiler.run((error, stats) => {
      compiler.close((closeError) => {
        if (error) rejectCompilation(error);
        else if (closeError) rejectCompilation(closeError);
        else if (!stats) rejectCompilation(new Error('Webpack completed without returning stats'));
        else resolveCompilation(stats);
      });
    });
  });
}

function configuration(
  directory: string,
  plugins: AcceptedPlugin[],
  captureFilename = 'capture.json',
): Configuration {
  return {
    context: directory,
    mode: 'development',
    target: 'node',
    devtool: false,
    entry: './input.css',
    output: {
      path: resolve(directory, 'dist'),
      filename: 'bundle.js',
    },
    module: {
      rules: [
        {
          test: /\.css$/i,
          use: [
            {
              loader: captureLoader,
              options: { filename: captureFilename },
            },
            {
              loader: webpackLoader,
              options: {
                sourceMap: true,
                postcssOptions: {
                  config: false,
                  plugins,
                },
              },
            },
          ],
        },
      ],
    },
  };
}

test('processes CSS and forwards warnings, messages, maps, and AST metadata', async () => {
  const directory = createProject();
  const input = resolve(directory, 'input.css');
  const dependency = resolve(directory, 'tokens.css');
  const missingDependency = resolve(directory, 'future.css');
  writeFileSync(input, '.card { color: red; }\n');
  writeFileSync(dependency, ':root { --brand: blue; }\n');

  const plugin: AcceptedPlugin = {
    postcssPlugin: 'webpack-loader-contract',
    Once(root, { result }) {
      result.warn('contract warning', { node: root.first });
      result.messages.push({ type: 'dependency', file: dependency });
      result.messages.push({ type: 'missing-dependency', file: missingDependency });
      result.messages.push({ type: 'dir-dependency', dir: directory, glob: '*.css' });
      result.messages.push({
        type: 'asset',
        file: 'postcss-go-asset.txt',
        content: 'emitted by @postcss-go/webpack-loader',
      });
    },
    Declaration(declaration) {
      declaration.value = 'blue';
    },
  };

  const stats = await compile(configuration(directory, [plugin]));
  const summary = stats.toJson({ all: false, errors: true, warnings: true, assets: true });

  expect(summary.errors).toEqual([]);
  expect(summary.warnings).toEqual([
    expect.objectContaining({ message: expect.stringContaining('contract warning') }),
  ]);
  expect(summary.assets?.map((asset) => asset.name)).toEqual(
    expect.arrayContaining(['bundle.js', 'capture.json', 'postcss-go-asset.txt']),
  );
  expect(readFileSync(resolve(directory, 'dist/postcss-go-asset.txt'), 'utf8')).toBe(
    'emitted by @postcss-go/webpack-loader',
  );

  const capture = JSON.parse(
    readFileSync(resolve(directory, 'dist/capture.json'), 'utf8'),
  ) as Capture;
  expect(capture.css).toContain('color: blue');
  expect(capture.css).not.toContain('sourceMappingURL=');
  expect(capture.map).toMatchObject({ version: 3 });
  expect(capture.map?.sources?.some((source) => source.endsWith('input.css'))).toBe(true);
  expect(capture.ast).toMatchObject({
    type: 'postcss',
    rootType: 'root',
    css: expect.stringContaining('color: blue'),
  });

  const dependencies = [...stats.compilation.fileDependencies].map((file) => realpathSync(file));
  expect(dependencies).toContain(realpathSync(dependency));
  expect(stats.compilation.missingDependencies.has(missingDependency)).toBe(true);
  expect(
    [...stats.compilation.contextDependencies].some(
      (context) => realpathSync(context) === realpathSync(directory),
    ),
  ).toBe(true);
});

test('reports postcss-go syntax errors through Webpack', async () => {
  const directory = createProject();
  writeFileSync(resolve(directory, 'input.css'), '.broken { color: red;\n');
  const plugin: AcceptedPlugin = {
    postcssPlugin: 'force-parse',
    Once() {},
  };

  const stats = await compile(configuration(directory, [plugin], 'unused.json'));
  const summary = stats.toJson({ all: false, errors: true, warnings: true });

  expect(summary.warnings).toEqual([]);
  expect(summary.errors).toHaveLength(1);
  expect(summary.errors?.[0]?.message).toContain('SyntaxError');
  expect(summary.errors?.[0]?.message).toContain('input.css');
});

test('loads postcss-go config and registers it as a build dependency', async () => {
  const directory = createProject();
  const configFile = resolve(directory, 'postcss.config.cjs');
  const input = resolve(directory, 'input.css');
  writeFileSync(input, '.configured { color: red; }\n');
  writeFileSync(
    configFile,
    `module.exports = {
  plugins: [{
    postcssPlugin: 'config-contract',
    Declaration(declaration) { declaration.value = 'green'; }
  }]
};
`,
  );

  const config = configuration(directory, []);
  const rule = config.module?.rules?.[0];
  if (!rule || typeof rule === 'string' || !Array.isArray(rule.use)) {
    throw new Error('Invalid test configuration');
  }
  const loaderUse = rule.use[1];
  if (!loaderUse || typeof loaderUse === 'string' || typeof loaderUse === 'function') {
    throw new Error('Invalid loader test configuration');
  }
  loaderUse.options = { sourceMap: true, postcssOptions: {} };

  const stats = await compile(config);
  const summary = stats.toJson({ all: false, errors: true, warnings: true });
  expect(summary.errors).toEqual([]);
  expect(summary.warnings).toEqual([]);
  const capture = JSON.parse(
    readFileSync(resolve(directory, 'dist/capture.json'), 'utf8'),
  ) as Capture;
  expect(capture.css).toContain('color: green');
  expect(
    [...stats.compilation.buildDependencies].map((dependency) => realpathSync(dependency)),
  ).toContain(realpathSync(configFile));
});

test('disables config map output when Webpack source maps are off', async () => {
  const directory = createProject();
  writeFileSync(resolve(directory, 'input.css'), '.mapped { color: red; }\n');
  writeFileSync(
    resolve(directory, 'postcss.config.cjs'),
    `module.exports = { map: true, plugins: [] };\n`,
  );

  const config = configuration(directory, [], 'no-inline-map.json');
  const rule = config.module?.rules?.[0];
  if (!rule || typeof rule === 'string' || !Array.isArray(rule.use)) {
    throw new Error('Invalid test configuration');
  }
  const loaderUse = rule.use[1];
  if (!loaderUse || typeof loaderUse === 'string' || typeof loaderUse === 'function') {
    throw new Error('Invalid loader test configuration');
  }
  loaderUse.options = { sourceMap: false, postcssOptions: {} };

  const stats = await compile(config);
  const summary = stats.toJson({ all: false, errors: true, warnings: true });
  expect(summary.errors).toEqual([]);
  expect(summary.warnings).toEqual([]);

  const capture = JSON.parse(
    readFileSync(resolve(directory, 'dist/no-inline-map.json'), 'utf8'),
  ) as Capture;
  expect(capture.css).toContain('color: red');
  expect(capture.css).not.toContain('sourceMappingURL=');
  expect(capture.map).toBeNull();
});

test('keeps from/to pinned to the Webpack resource path', async () => {
  const directory = createProject();
  const input = resolve(directory, 'input.css');
  writeFileSync(input, '.from-override { color: red; }\n');
  const plugin: AcceptedPlugin = {
    postcssPlugin: 'from-override-contract',
    Declaration(declaration) {
      declaration.value = 'blue';
    },
  };

  const stats = await compile({
    context: directory,
    mode: 'development',
    target: 'node',
    devtool: false,
    entry: './input.css',
    output: {
      path: resolve(directory, 'dist'),
      filename: 'bundle.js',
    },
    module: {
      rules: [
        {
          test: /\.css$/i,
          use: [
            {
              loader: captureLoader,
              options: { filename: 'from-override.json' },
            },
            {
              loader: webpackLoader,
              options: {
                sourceMap: true,
                postcssOptions: {
                  config: false,
                  from: '/virtual/custom.css',
                  to: '/virtual/custom.css',
                  plugins: [plugin],
                },
              },
            },
          ],
        },
      ],
    },
  });
  const summary = stats.toJson({ all: false, errors: true, warnings: true });
  expect(summary.errors).toEqual([]);
  expect(summary.warnings).toEqual([]);

  const capture = JSON.parse(
    readFileSync(resolve(directory, 'dist/from-override.json'), 'utf8'),
  ) as Capture;
  expect(capture.css).toContain('color: blue');
  expect(capture.map?.sources?.some((source) => source.endsWith('input.css'))).toBe(true);
  expect(capture.map?.sources?.some((source) => source.includes('virtual'))).toBe(false);
});

test('composes previous source maps from upstream loaders', async () => {
  const directory = createProject();
  const originalSource = 'original.scss';
  const originalContent = '$color: purple;\n.from-upstream { color: $color; }\n';
  writeFileSync(resolve(directory, 'input.css'), '.from-upstream { color: purple; }\n');
  const plugin: AcceptedPlugin = {
    postcssPlugin: 'previous-map-contract',
    Declaration(declaration) {
      declaration.value = 'orange';
    },
  };

  const config = configuration(directory, [plugin], 'previous-map.json');
  const rule = config.module?.rules?.[0];
  if (!rule || typeof rule === 'string' || !Array.isArray(rule.use)) {
    throw new Error('Invalid test configuration');
  }
  rule.use.push({
    loader: previousMapLoader,
    options: { source: originalSource, sourceContent: originalContent },
  });

  const stats = await compile(config);
  const summary = stats.toJson({ all: false, errors: true, warnings: true });
  expect(summary.errors).toEqual([]);
  expect(summary.warnings).toEqual([]);

  const capture = JSON.parse(
    readFileSync(resolve(directory, 'dist/previous-map.json'), 'utf8'),
  ) as Capture;
  expect(capture.css).toContain('color: orange');
  expect(capture.map).toMatchObject({ version: 3 });
  expect(capture.map?.sources?.some((source) => source.endsWith(originalSource))).toBe(true);
  expect(capture.map?.sourcesContent).toEqual(
    expect.arrayContaining([expect.stringContaining('$color: purple')]),
  );
});

test('accepts a function postcssOptions factory', async () => {
  const directory = createProject();
  writeFileSync(resolve(directory, 'input.css'), '.factory { color: red; }\n');
  const seen: string[] = [];

  const stats = await compile({
    context: directory,
    mode: 'development',
    target: 'node',
    devtool: false,
    entry: './input.css',
    output: {
      path: resolve(directory, 'dist'),
      filename: 'bundle.js',
    },
    module: {
      rules: [
        {
          test: /\.css$/i,
          use: [
            {
              loader: captureLoader,
              options: { filename: 'factory-capture.json' },
            },
            {
              loader: webpackLoader,
              options: {
                sourceMap: true,
                postcssOptions(api: { file: string; mode: string }) {
                  seen.push(api.mode, api.file);
                  return {
                    config: false,
                    plugins: [
                      {
                        postcssPlugin: 'factory-contract',
                        Declaration(declaration: { value: string }) {
                          declaration.value = 'teal';
                        },
                      },
                    ],
                  };
                },
              },
            },
          ],
        },
      ],
    },
  });
  const summary = stats.toJson({ all: false, errors: true, warnings: true });
  expect(summary.errors).toEqual([]);
  expect(seen[0]).toBe('development');
  expect(seen[1]).toContain('input.css');
  expect(readFileSync(resolve(directory, 'dist/factory-capture.json'), 'utf8')).toContain(
    'color: teal',
  );
});

test('documented css-loader chain works without postcss-loader', async () => {
  const directory = createProject();
  writeFileSync(resolve(directory, 'input.css'), '.chain { color: red; }\n');
  const plugin: AcceptedPlugin = {
    postcssPlugin: 'css-loader-contract',
    Declaration(declaration) {
      declaration.value = 'blue';
    },
  };

  const stats = await compile({
    context: directory,
    mode: 'development',
    target: 'node',
    devtool: false,
    entry: './input.css',
    output: {
      path: resolve(directory, 'dist'),
      filename: 'bundle.js',
      library: { type: 'commonjs2' },
    },
    module: {
      rules: [
        {
          test: /\.css$/i,
          use: [
            {
              loader: cssLoader,
              options: {
                exportType: 'string',
                esModule: false,
                sourceMap: true,
              },
            },
            {
              loader: webpackLoader,
              options: {
                sourceMap: true,
                postcssOptions: {
                  config: false,
                  plugins: [plugin],
                },
              },
            },
          ],
        },
      ],
    },
  });
  const summary = stats.toJson({ all: false, errors: true, warnings: true });
  expect(summary.errors).toEqual([]);
  expect(summary.warnings).toEqual([]);
  const css = require(resolve(directory, 'dist/bundle.js')) as unknown;
  expect(typeof css).toBe('string');
  expect(css).toContain('color: blue');
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
