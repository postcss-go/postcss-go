import { expect, test } from 'vitest';

import cli from './helpers/cli.js';

test('writes to stdout by default', async () => {
  const { error, stdout, stderr } = await cli(['test/fixtures/a.css', '--no-map']);

  expect(error, stderr).toBeFalsy();
  expect(stdout).toContain('color: red');
});
