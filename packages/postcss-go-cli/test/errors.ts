import path from 'path';
import { expect, test } from 'vitest';

import cli from './helpers/cli.ts';

const fixtureDir = path.resolve('test/fixtures/errors');

test('fails when config sets from/to options', async () => {
  const { error, stderr } = await cli(['input.css', '--no-map'], fixtureDir);

  expect(error).toBeTruthy();
  expect(stderr).toContain(
    'Config Error: Can not set from or to options in config file, use CLI arguments instead',
  );
});

test('fails when stdin is empty', async () => {
  const { error, stderr } = await cli([], fixtureDir, { stdin: '' });

  expect(error).toBeTruthy();
  expect(stderr).toContain('Input Error: Did not receive any STDIN');
});

test('watch mode exits on invalid config errors', async () => {
  const { error, stderr, code } = await cli(
    ['input.css', '-o', 'output.css', '--watch', '--no-map'],
    fixtureDir,
    {
      env: { FORCE_IS_TTY: 'true' },
      timeout: 1000,
    },
  );

  expect(error).toBeTruthy();
  expect(code).toBe(1);
  expect(stderr).toContain(
    'Config Error: Can not set from or to options in config file, use CLI arguments instead',
  );
});
