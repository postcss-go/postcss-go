import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

import cli from './helpers/cli.ts';
import tmp from './helpers/tmp.ts';
import read from './helpers/read.ts';
import {
  assertGoCompatibility,
  getEffectiveMapOption,
  isExternalSourceMap,
  isSourceMapEnabled,
  processWithGoEngine,
} from '../lib/engine.js';
import {
  getBundledGoBridgeBinPath,
  resolveGoBridgeServiceOptions,
} from '../lib/resolveGoBridge.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function waitForContent(file: string, content: string, timeout = 20000) {
  const deadline = Date.now() + timeout;

  return new Promise<void>((resolve, reject) => {
    const check = async () => {
      try {
        if ((await read(file)).includes(content)) {
          resolve();
          return;
        }
      } catch {
        // File may not exist yet.
      }

      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for ${file} to contain ${content}`));
        return;
      }

      setTimeout(check, 50);
    };

    void check();
  });
}

test.skipIf(process.env.COVERAGE_RUN === 'true')(
  'writes output with the Go engine by default',
  { timeout: 25000 },
  async () => {
    const output = tmp('output.css');
    const child = spawn(
      process.execPath,
      [path.join(packageRoot, 'index.js'), 'test/fixtures/a.css', '-o', output, '--no-map'],
      { cwd: packageRoot },
    );

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    try {
      await waitForContent(output, 'color: red');
      expect(stderr).toBe('');
      expect(await read(output)).toContain('color: red');
    } finally {
      child.kill();
      await Promise.race([
        new Promise((resolve) => child.on('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
    }
  },
);

test('the Go engine runs --use plugins by default', async () => {
  const output = tmp('output.css');

  const { error, stderr } = await cli([
    'test/fixtures/a.css',
    '-o',
    output,
    '--no-map',
    '-u',
    path.resolve('test/fixtures/plugins/to-blue.mjs'),
  ]);

  expect(error, stderr).toBeFalsy();
  expect(await read(output)).toContain('color: blue');
});

test('the Go engine runs config plugins by default', async () => {
  const fixtureDir = 'test/fixtures/config';
  const output = path.resolve(tmp('output.css'));

  const { error, stderr } = await cli(['input.css', '-o', output, '--no-map'], fixtureDir);

  expect(error, stderr).toBeFalsy();
  expect(await read(output)).toContain('color: tomato');
});

test('the Go engine rejects config parser overrides', async () => {
  const fixtureDir = 'test/fixtures/config-parser';

  const { error, stderr } = await cli(
    ['input.css', '-o', tmp('output.css'), '--no-map'],
    fixtureDir,
  );

  expect(error).toBeTruthy();
  expect(stderr).toContain(
    'Engine Error: postcss-go does not support postcss.config.js parser/syntax/stringifier yet',
  );
});

test('the Go engine writes external sourcemaps by default', async () => {
  const output = tmp('output.css');

  const { error, stderr } = await cli(['test/fixtures/a.css', '-o', output, '--map']);

  expect(error, stderr).toBeFalsy();
  const css = await read(output);
  const map = JSON.parse(await read(`${output}.map`));
  expect(css).toContain('sourceMappingURL=output.css.map');
  expect(map.version).toBe(3);
  expect(map.sources[0]).toContain('a.css');
  expect(map.mappings).toBeTruthy();
});

test('the Go engine composes plugin sourcemaps back to the original CSS', async () => {
  const output = tmp('output.css');

  const { error, stderr } = await cli([
    'test/fixtures/a.css',
    '-o',
    output,
    '--map',
    '-u',
    path.resolve('test/fixtures/plugins/to-blue.mjs'),
  ]);

  expect(error, stderr).toBeFalsy();
  const map = JSON.parse(await read(`${output}.map`));
  expect(await read(output)).toContain('color: blue');
  expect(map.sourcesContent).toEqual([expect.stringContaining('color: red')]);
  expect(map.sources[0]).not.toMatch(/^[/\\]/);
});

test('the Go engine writes default inline sourcemaps', async () => {
  const output = tmp('output.css');

  const { error, stderr } = await cli(['test/fixtures/a.css', '-o', output]);

  expect(error, stderr).toBeFalsy();
  expect(await read(output)).toContain('sourceMappingURL=data:application/json;base64,');
});

test('the Go engine supports postcss.config.js map options', async () => {
  const fixtureDir = 'test/fixtures/config';
  const output = path.resolve(tmp('output.css'));

  const { error, stderr } = await cli(['input.css', '-o', output], fixtureDir);

  expect(error, stderr).toBeFalsy();
  expect(await read(output)).toContain('sourceMappingURL=data:application/json;base64,');
});

test('the Go engine supports explicit map: true in postcss.config.js', async () => {
  const fixtureDir = 'test/fixtures/config-map';
  const output = path.resolve(tmp('output.css'));

  const { error, stderr } = await cli(['input.css', '-o', output, '--no-map'], fixtureDir);

  expect(error, stderr).toBeFalsy();
  expect(await read(output)).toContain('sourceMappingURL=data:application/json;base64,');
});

test('isExternalSourceMap detects external map configurations', () => {
  expect(isExternalSourceMap(false)).toBe(false);
  expect(isExternalSourceMap({ inline: true })).toBe(false);
  expect(isExternalSourceMap(true)).toBe(false);
  expect(isExternalSourceMap({ inline: false })).toBe(true);
});

test('isSourceMapEnabled treats only false and undefined as disabled', () => {
  expect(isSourceMapEnabled(false)).toBe(false);
  expect(isSourceMapEnabled(undefined)).toBe(false);
  expect(isSourceMapEnabled(true)).toBe(true);
  expect(isSourceMapEnabled({ inline: true })).toBe(true);
  expect(isSourceMapEnabled({ inline: false })).toBe(true);
});

test('getEffectiveMapOption prefers config.options.map', () => {
  expect(getEffectiveMapOption({ options: { map: false }, map: true })).toBe(false);
  expect(getEffectiveMapOption({ map: { inline: true } })).toEqual({ inline: true });
});

test('Go compatibility allows enabled map options', () => {
  expect(() =>
    assertGoCompatibility({}, { options: { map: { inline: true } }, plugins: [] }),
  ).not.toThrow();
});

test('resolveGoBridgeServiceOptions prefers bundled binary', () => {
  expect(resolveGoBridgeServiceOptions()).toEqual({
    binPath: getBundledGoBridgeBinPath(),
  });
});

test('processWithGoEngine serializes requests', async () => {
  let active = 0;
  let maxActive = 0;

  const engine = {
    name: 'go',
    queue: Promise.resolve(),
    service: {
      async process(css) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return { css, messages: [] };
      },
    },
  };

  const results = await Promise.all([
    processWithGoEngine(engine, {}, '.a { color: red; }', { from: 'a.css' }),
    processWithGoEngine(engine, {}, '.b { color: blue; }', { from: 'b.css' }),
    processWithGoEngine(engine, {}, '.c { color: green; }', { from: 'c.css' }),
  ]);

  expect(maxActive).toBe(1);
  expect(results.map((result) => result.css)).toEqual([
    '.a { color: red; }',
    '.b { color: blue; }',
    '.c { color: green; }',
  ]);
});
