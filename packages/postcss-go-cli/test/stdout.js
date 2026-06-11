import test from 'ava';

import cli from './helpers/cli.js';

test('writes to stdout by default', async (t) => {
  const { error, stdout, stderr } = await cli([
    'test/fixtures/a.css',
    '--no-map',
  ]);

  t.falsy(error, stderr);
  t.true(stdout.includes('color: red'));
});
