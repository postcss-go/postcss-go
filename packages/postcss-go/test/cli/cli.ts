import { expect, test } from 'vitest';

import cli from './helpers/cli.ts';
import tmp from './helpers/tmp.ts';
import read from './helpers/read.ts';

test('works with defaults', async () => {
  const output = tmp('output.css');

  const { error, stderr } = await cli(['test/fixtures/a.css', '-o', output, '--no-map']);

  expect(error, stderr).toBeFalsy();
  expect((await read(output)).trim()).toBe((await read('test/fixtures/a.css')).trim());
});

test('rejects custom parser, syntax, and stringifier modules', async () => {
  const { error, stderr } = await cli([
    'test/fixtures/a.css',
    '-o',
    tmp('output.css'),
    '--no-map',
    '--parser',
    './test/fixtures/custom-modules/parser.mjs',
    '--syntax',
    './test/fixtures/custom-modules/syntax.mjs',
    '--stringifier',
    './test/fixtures/custom-modules/stringifier.mjs',
  ]);

  expect(error).toBeTruthy();
  expect(stderr).toContain(
    'Engine Error: postcss-go does not support custom parser/syntax/stringifier yet',
  );
});

test('rejects the removed --engine option', async () => {
  const { error, stderr } = await cli(['test/fixtures/a.css', '--no-map', '--engine', 'go']);

  expect(error).toBeTruthy();
  expect(stderr).toContain('Unknown argument: engine');
});
