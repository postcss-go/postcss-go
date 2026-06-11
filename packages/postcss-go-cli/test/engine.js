import test from 'ava';

import cli from './helpers/cli.js';
import tmp from './helpers/tmp.js';
import read from './helpers/read.js';

test('--engine go writes output', async (t) => {
  const output = tmp('output.css');

  const { error, stderr } = await cli([
    'test/fixtures/a.css',
    '-o',
    output,
    '--no-map',
    '--engine',
    'go',
  ]);

  t.falsy(error, stderr);
  t.truthy(await read(output));
});

test('--engine go rejects --use plugins', async (t) => {
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

  t.truthy(error);
});

test('--engine go rejects config plugins', async (t) => {
  const fixtureDir = 'test/fixtures/config';

  const { error, stderr } = await cli(
    ['input.css', '-o', tmp('output.css'), '--no-map', '--engine', 'go'],
    fixtureDir,
  );

  t.truthy(error);
  t.true(
    stderr.includes(
      'Engine Error: postcss-go does not support postcss.config.js plugins yet; use --engine postcss',
    ),
  );
});

test('--engine go rejects external sourcemaps', async (t) => {
  const output = tmp('output.css');

  const { error, stderr } = await cli([
    'test/fixtures/a.css',
    '-o',
    output,
    '--map',
    '--engine',
    'go',
  ]);

  t.truthy(error);
  t.true(
    stderr.includes(
      'Engine Error: postcss-go does not support external sourcemaps yet; use --engine postcss',
    ),
  );
});
