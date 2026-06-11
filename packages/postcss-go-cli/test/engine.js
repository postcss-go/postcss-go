import { expect, test } from 'vitest';

import cli from './helpers/cli.js';
import tmp from './helpers/tmp.js';
import read from './helpers/read.js';
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

test('--engine go writes output', async () => {
  const output = tmp('output.css');

  const { error, stderr } = await cli([
    'test/fixtures/a.css',
    '-o',
    output,
    '--no-map',
    '--engine',
    'go',
  ]);

  expect(error, stderr).toBeFalsy();
  expect(await read(output)).toContain('color: red');
});

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
