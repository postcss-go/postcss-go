import test from 'ava';
import path from 'path';

import cli from './helpers/cli.js';

const fixtureDir = path.resolve('test/fixtures/config');

test('loads postcss.config.cjs from cwd for file input', async (t) => {
  const { error, stdout, stderr } = await cli(['input.css', '--no-map'], fixtureDir);

  t.falsy(error, stderr);
  t.true(stdout.includes('color: tomato'));
});

test('loads postcss.config.cjs from cwd for stdin input', async (t) => {
  const { error, stdout, stderr } = await cli([], fixtureDir, {
    stdin: '.stdin { color: red; }\n',
  });

  t.falsy(error, stderr);
  t.true(stdout.includes('color: tomato'));
});

test('--env is available in postcss config context', async (t) => {
  const { error, stdout, stderr } = await cli(
    ['input.css', '--no-map', '--env', 'production'],
    fixtureDir,
  );

  t.falsy(error, stderr);
  t.true(stdout.includes('border-color: black'));
});
