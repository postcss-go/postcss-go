import test from 'ava';
import path from 'path';

import cli from './helpers/cli.js';

const fixtureDir = path.resolve('test/fixtures/errors');

test('fails when config sets from/to options', async (t) => {
  const { error, stderr } = await cli(['input.css', '--no-map'], fixtureDir);

  t.truthy(error);
  t.true(
    stderr.includes(
      'Config Error: Can not set from or to options in config file, use CLI arguments instead',
    ),
  );
});

test('fails when stdin is empty', async (t) => {
  const { error, stderr } = await cli([], fixtureDir, { stdin: '' });

  t.truthy(error);
  t.true(stderr.includes('Input Error: Did not receive any STDIN'));
});

test('watch mode exits on invalid config errors', async (t) => {
  const { error, stderr, code } = await cli(
    ['input.css', '-o', 'output.css', '--watch', '--no-map'],
    fixtureDir,
    {
      env: { FORCE_IS_TTY: 'true' },
      timeout: 1000,
    },
  );

  t.truthy(error);
  t.is(code, 1);
  t.true(
    stderr.includes(
      'Config Error: Can not set from or to options in config file, use CLI arguments instead',
    ),
  );
});
