import fs from 'node:fs/promises';
import path from 'path';
import { expect, test } from 'vitest';

import { loadConfig, isPathSpecifier } from '../src/config.ts';
import cli from './helpers/cli.ts';
import tmp from './helpers/tmp.ts';
import read from './helpers/read.ts';

const fixtureDir = path.resolve('test/fixtures/config');

test('loads postcss.config.cjs from cwd for file input', async () => {
  const { error, stdout, stderr } = await cli(['input.css', '--no-map'], fixtureDir);

  expect(error, stderr).toBeFalsy();
  expect(stdout).toContain('color: tomato');
});

test('loads postcss.config.cjs from cwd for stdin input', async () => {
  const { error, stdout, stderr } = await cli([], fixtureDir, {
    stdin: '.stdin { color: red; }\n',
  });

  expect(error, stderr).toBeFalsy();
  expect(stdout).toContain('color: tomato');
});

test('--env is available in postcss config context', async () => {
  const { error, stdout, stderr } = await cli(
    ['input.css', '--no-map', '--env', 'production'],
    fixtureDir,
  );

  expect(error, stderr).toBeFalsy();
  expect(stdout).toContain('border-color: black');
});

test('loads config relative to each file during multi-file runs', async () => {
  const outputDir = tmp();

  const { error, stderr } = await cli([
    'test/fixtures/config-multi/alpha/input.css',
    'test/fixtures/config-multi/beta/input.css',
    '--dir',
    outputDir,
    '--base',
    'test/fixtures/config-multi',
    '--no-map',
  ]);

  expect(error, stderr).toBeFalsy();
  expect(await read(path.join(outputDir, 'alpha/input.css'))).toContain('tomato');
  expect(await read(path.join(outputDir, 'beta/input.css'))).toContain('deepskyblue');
});

test('exposes the standalone context and merges nested and top-level options', async () => {
  const directory = tmp();
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, 'postcss.config.mjs'),
    `export default ctx => ({
      options: { map: false, fromContext: ctx.env + ':' + ctx.file.basename },
      map: { inline: false },
      configDirectory: ctx.cwd
    })`,
  );

  const loaded = await loadConfig(
    {
      env: 'test',
      cwd: '/should-not-win',
      file: { dirname: directory, basename: 'input.css', extname: '.css' },
      options: { to: 'output.css' },
    },
    directory,
  );

  expect(loaded?.options).toMatchObject({
    to: 'output.css',
    fromContext: 'test:input.css',
    map: { inline: false },
    configDirectory: path.resolve(directory),
  });
});

test('isPathSpecifier recognizes Windows drive paths', () => {
  expect(isPathSpecifier('./local.js')).toBe(true);
  expect(isPathSpecifier('/abs/plugin.js')).toBe(true);
  expect(isPathSpecifier('C:\\plugins\\foo.js')).toBe(true);
  expect(isPathSpecifier('D:/plugins/foo.js')).toBe(true);
  expect(isPathSpecifier('\\plugins\\foo.js')).toBe(true);
  expect(isPathSpecifier('\\\\server\\share\\plugin.js')).toBe(true);
  expect(isPathSpecifier('autoprefixer')).toBe(false);
});

test('loads object-form relative plugin paths from config', async () => {
  const directory = tmp();
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, 'to-olive.mjs'),
    `export default () => ({
      postcssPlugin: 'to-olive',
      Declaration(decl) {
        if (decl.prop === 'color') decl.value = 'olive';
      },
    });
    `,
  );
  await fs.writeFile(
    path.join(directory, 'postcss.config.mjs'),
    `export default { plugins: { './to-olive.mjs': true } };`,
  );

  const loaded = await loadConfig({}, directory);
  expect(loaded?.plugins).toHaveLength(1);
  expect((loaded?.plugins[0] as { postcssPlugin?: string }).postcssPlugin).toBe('to-olive');
});

test('does not walk ancestors when the search path is missing', async () => {
  const directory = tmp();
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, 'postcss.config.mjs'),
    `export default { map: false, marker: 'parent' };`,
  );

  const missing = path.join(directory, 'nested', 'missing.config.mjs');
  const loaded = await loadConfig({}, missing);
  expect(loaded).toBeUndefined();
});

test('CLI rejects an explicit --config path that does not exist', async () => {
  const directory = tmp();
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'input.css'), 'a { color: red; }');
  await fs.writeFile(path.join(directory, 'postcss.config.mjs'), `export default { map: false };`);

  const missing = path.join(directory, 'missing.config.mjs');
  const { error, stderr } = await cli(
    ['input.css', '--no-map', '--config', missing, '-o', 'out.css'],
    directory,
  );

  expect(error).toBeTruthy();
  expect(stderr).toMatch(/Config Error: Could not find a config file/);
});

test('loads JSON configs and rejects invalid exports', async () => {
  const directory = tmp();
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, '.postcssrc.json'),
    JSON.stringify({ map: false, marker: 'json' }),
  );

  const loaded = await loadConfig({}, directory);
  expect(loaded?.options).toMatchObject({ map: false, marker: 'json' });
  expect(loaded?.plugins).toEqual([]);

  const badDir = tmp();
  await fs.mkdir(badDir, { recursive: true });
  await fs.writeFile(path.join(badDir, 'postcss.config.mjs'), `export default 'nope';`);
  await expect(loadConfig({}, badDir)).rejects.toThrow(/must export an object/);

  const badOptions = tmp();
  await fs.mkdir(badOptions, { recursive: true });
  await fs.writeFile(
    path.join(badOptions, 'postcss.config.mjs'),
    `export default { options: null };`,
  );
  await expect(loadConfig({}, badOptions)).rejects.toThrow(/options must be an object/);
});

test('normalizeConfiguredPlugins supports arrays, false entries, and options objects', async () => {
  const directory = tmp();
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, 'with-opts.mjs'),
    `export default (opts = {}) => ({
      postcssPlugin: 'with-opts',
      Once(root) {
        root.append({ prop: 'x', value: opts.value || 'default' });
      },
    });`,
  );
  await fs.writeFile(
    path.join(directory, 'as-object.mjs'),
    `export default { postcssPlugin: 'as-object' };`,
  );
  await fs.writeFile(
    path.join(directory, 'postcss.config.mjs'),
    `import withOpts from './with-opts.mjs';
     import asObject from './as-object.mjs';
     export default {
       plugins: [
         withOpts({ value: 'from-array' }),
         false,
         null,
         asObject,
       ],
     };`,
  );

  const arrayLoaded = await loadConfig({}, directory);
  expect(arrayLoaded?.plugins).toHaveLength(2);

  const objectDir = tmp();
  await fs.mkdir(objectDir, { recursive: true });
  await fs.writeFile(
    path.join(objectDir, 'with-opts.mjs'),
    `export default (opts = {}) => ({ postcssPlugin: 'with-opts-' + (opts.tag || 'none') });`,
  );
  await fs.writeFile(
    path.join(objectDir, 'postcss.config.mjs'),
    `export default {
      plugins: {
        './with-opts.mjs': { tag: 'object' },
        'skip-me': false,
      },
    };`,
  );
  const objectLoaded = await loadConfig({}, objectDir);
  expect(objectLoaded?.plugins).toHaveLength(1);
  expect((objectLoaded?.plugins[0] as { postcssPlugin?: string }).postcssPlugin).toBe(
    'with-opts-object',
  );

  const badPlugins = tmp();
  await fs.mkdir(badPlugins, { recursive: true });
  await fs.writeFile(
    path.join(badPlugins, 'postcss.config.mjs'),
    `export default { plugins: 'nope' };`,
  );
  await expect(loadConfig({}, badPlugins)).rejects.toThrow(/plugins must be an array or an object/);
});

test('normalizeConfiguredPlugins resolves absolute path module ids', async () => {
  const directory = tmp();
  await fs.mkdir(directory, { recursive: true });
  const pluginFile = path.join(directory, 'abs-plugin.mjs');
  await fs.writeFile(pluginFile, `export default { postcssPlugin: 'abs-plugin' };`);
  await fs.writeFile(
    path.join(directory, 'postcss.config.mjs'),
    `export default { plugins: { ${JSON.stringify(pluginFile)}: true } };`,
  );

  const loaded = await loadConfig({}, directory);
  expect((loaded?.plugins[0] as { postcssPlugin?: string }).postcssPlugin).toBe('abs-plugin');
});

test('loadConfig accepts an explicit config file path', async () => {
  const directory = tmp();
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'custom.config.mjs');
  await fs.writeFile(file, `export default { map: false, via: 'file' };`);

  const loaded = await loadConfig({}, file);
  expect(loaded?.file).toBe(path.resolve(file));
  expect(loaded?.options).toMatchObject({ map: false, via: 'file' });
});

test('loadConfig defaults env to development when NODE_ENV is unset', async () => {
  const previous = process.env.NODE_ENV;
  const directory = tmp();
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, 'postcss.config.mjs'),
    `export default (ctx) => ({ map: false, envSeen: ctx.env });`,
  );

  try {
    delete process.env.NODE_ENV;
    const loaded = await loadConfig({}, directory);
    expect(loaded?.options).toMatchObject({ envSeen: 'development' });
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
