import path from 'path';
import { expect, test } from 'vitest';

import cli from './helpers/cli.js';
import tmp from './helpers/tmp.js';
import read from './helpers/read.js';

test('--base --dir works', async () => {
  const dir = tmp();

  const { error, stderr } = await cli([
    '"test/fixtures/base/**/*.css"',
    '--dir',
    dir,
    '--base',
    'test/fixtures/base',
    '--no-map',
  ]);

  expect(error, stderr).toBeFalsy();

  expect(await read(path.join(dir, 'level-1/level-2/a.css'))).toBe(
    await read('test/fixtures/base/level-1/level-2/a.css'),
  );

  expect(await read(path.join(dir, 'level-1/b.css'))).toBe(
    await read('test/fixtures/base/level-1/b.css'),
  );
});
