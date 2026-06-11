import { expect, test } from 'vitest';

import cli from './helpers/cli.js';
import tmp from './helpers/tmp.js';
import read from './helpers/read.js';
import { processWithEngine } from '../lib/engine.js';

test('--engine go writes output', async () => {
  const output = tmp('output.css');

  const { error, stderr } = await cli(['test/fixtures/a.css', '-o', output, '--no-map', '--engine', 'go']);

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
    'Engine Error: postcss-go does not support external sourcemaps yet; use --engine postcss',
  );
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
