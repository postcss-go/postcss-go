import { expect, test } from 'vitest';

import cli from './helpers/cli.ts';
import tmp from './helpers/tmp.ts';
import read from './helpers/read.ts';

test('works with defaults', async () => {
  const output = tmp('output.css');

  const { error, stderr } = await cli(['test/fixtures/a.css', '-o', output, '--no-map']);

  expect(error, stderr).toBeFalsy();
  expect(await read(output)).toBe(await read('test/fixtures/a.css'));
});

test('uses default exports for custom parser, syntax, and stringifier modules', async () => {
  const output = tmp('output.css');

  const { error, stderr } = await cli([
    'test/fixtures/a.css',
    '-o',
    output,
    '--no-map',
    '--parser',
    './test/fixtures/custom-modules/parser.mjs',
    '--syntax',
    './test/fixtures/custom-modules/syntax.mjs',
    '--stringifier',
    './test/fixtures/custom-modules/stringifier.mjs',
  ]);

  expect(error, stderr).toBeFalsy();
  expect(await read(output)).toBe(await read('test/fixtures/a.css'));
});
