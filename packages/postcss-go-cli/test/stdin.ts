import path from 'path';
import { expect, test } from 'vitest';

import cli from './helpers/cli.ts';
import tmp from './helpers/tmp.ts';
import read from './helpers/read.ts';

test('stdin with -o keeps from and to distinct for plugins', async () => {
  const output = tmp('stdin-output.css');

  const { error, stderr } = await cli(
    ['-o', output, '--no-map', '-u', path.resolve('test/fixtures/plugins/assert-from-to.mjs')],
    undefined,
    { stdin: '.stdin { color: red; }\n' },
  );

  expect(error, stderr).toBeFalsy();
  expect(await read(output)).toContain('color: red');
});
