import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

import cli from './helpers/cli.ts';
import tmp from './helpers/tmp.ts';
import read from './helpers/read.ts';
import {
  assertGoEngineCompatible,
  getEffectiveMapOption,
  isExternalSourceMap,
  isSourceMapEnabled,
  processWithEngine,
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
  '--engine go writes output',
  { timeout: 25000 },
  async () => {
  const output = tmp('output.css');
  const child = spawn(
    process.execPath,
    [path.join(packageRoot, 'index.js'), 'test/fixtures/a.css', '-o', output, '--no-map', '--engine', 'go'],
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
    child.kill('SIGKILL');
    await Promise.race([
      new Promise((resolve) => child.on('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
  }
  },
);

test('--engine go rejects --use plugins', async () => {
  const output = tmp('output.css');

  const { error } = await cli([
    'test/fixtures/a.css',
    '-o',
    output,
    '--no-map',
    '--engine',
    'go',
    '-u',
    'postcss',
  ]);

  expect(error).toBeTruthy();
});

test('--engine go rejects config plugins', async () => {
  const fixtureDir = 'test/fixtures/config';

  const { error, stderr } = await cli(
    ['input.css', '-o', tmp('output.css'), '--no-map', '--engine', 'go'],
    fixtureDir,
  );

  expect(error).toBeTruthy();
  expect(stderr).toContain(
    'Engine Error: postcss-go does not support postcss.config.js plugins yet; use --engine postcss',
  );
});

test('--engine go rejects config parser overrides', async () => {
  const fixtureDir = 'test/fixtures/config-parser';

  const { error, stderr } = await cli(
    ['input.css', '-o', tmp('output.css'), '--no-map', '--engine', 'go'],
    fixtureDir,
  );

  expect(error).toBeTruthy();
  expect(stderr).toContain(
    'Engine Error: postcss-go does not support postcss.config.js parser/syntax/stringifier yet; use --engine postcss',
  );
});

test('--engine go rejects external sourcemaps', async () => {
  const output = tmp('output.css');

  const { error, stderr } = await cli([
    'test/fixtures/a.css',
    '-o',
    output,
    '--map',
    '--engine',
    'go',
  ]);

  expect(error).toBeTruthy();
  expect(stderr).toContain(
    'Engine Error: postcss-go does not support sourcemaps yet; use --engine postcss',
  );
});

test('--engine go rejects default inline sourcemaps', async () => {
  const output = tmp('output.css');

  const { error, stderr } = await cli(['test/fixtures/a.css', '-o', output, '--engine', 'go']);

  expect(error).toBeTruthy();
  expect(stderr).toContain(
    'Engine Error: postcss-go does not support sourcemaps yet; use --engine postcss',
  );
});

test('--engine go rejects postcss.config.js map options', async () => {
  const fixtureDir = 'test/fixtures/config';

  const { error, stderr } = await cli(
    ['input.css', '-o', tmp('output.css'), '--engine', 'go'],
    fixtureDir,
  );

  expect(error).toBeTruthy();
  expect(stderr).toContain(
    'Engine Error: postcss-go does not support sourcemaps yet; use --engine postcss',
  );
});

test('--engine go rejects explicit map: true in postcss.config.js', async () => {
  const fixtureDir = 'test/fixtures/config-map';

  const { error, stderr } = await cli(
    ['input.css', '-o', tmp('output.css'), '--no-map', '--engine', 'go'],
    fixtureDir,
  );

  expect(error).toBeTruthy();
  expect(stderr).toContain(
    'Engine Error: postcss-go does not support sourcemaps yet; use --engine postcss',
  );
});

test('isExternalSourceMap detects external map configurations', () => {
  expect(isExternalSourceMap(false)).toBe(false);
  expect(isExternalSourceMap({ inline: true })).toBe(false);
  expect(isExternalSourceMap(true)).toBe(true);
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

test('assertGoEngineCompatible rejects enabled map options from config', () => {
  expect(() =>
    assertGoEngineCompatible({ engine: 'go' }, { options: { map: { inline: true } }, plugins: [] }),
  ).toThrow('Engine Error: postcss-go does not support sourcemaps yet; use --engine postcss');
});

test('resolveGoBridgeServiceOptions prefers bundled binary', () => {
  expect(resolveGoBridgeServiceOptions()).toEqual({
    binPath: getBundledGoBridgeBinPath(),
  });
});

test('processWithEngine serializes go engine requests', async () => {
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
    processWithEngine(engine, {}, '.a { color: red; }', { from: 'a.css' }),
    processWithEngine(engine, {}, '.b { color: blue; }', { from: 'b.css' }),
    processWithEngine(engine, {}, '.c { color: green; }', { from: 'c.css' }),
  ]);

  expect(maxActive).toBe(1);
  expect(results.map((result) => result.css)).toEqual([
    '.a { color: red; }',
    '.b { color: blue; }',
    '.c { color: green; }',
  ]);
});
