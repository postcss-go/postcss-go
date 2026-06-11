import path from 'path';
import { expect, test } from 'vitest';

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
