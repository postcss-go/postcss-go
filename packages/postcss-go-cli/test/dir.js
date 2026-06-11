import path from 'path';
import { expect, test } from 'vitest';

import cli from './helpers/cli.js';
import tmp from './helpers/tmp.js';
import read from './helpers/read.js';

test('--dir works', async () => {
  const dir = tmp();

  const { error, stderr } = await cli([
    'test/fixtures/a.css',
    'test/fixtures/b.css',
    '--dir',
    dir,
    '--no-map',
  ]);

  expect(error, stderr).toBeFalsy();
  expect(await read(path.join(dir, 'a.css'))).toBe(await read('test/fixtures/a.css'));
  expect(await read(path.join(dir, 'b.css'))).toBe(await read('test/fixtures/b.css'));
});
