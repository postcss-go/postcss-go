import fs from 'node:fs/promises';
import path from 'path';
import { expect, test } from 'vitest';

import cli from './helpers/cli.js';
import read from './helpers/read.js';
import tmp from './helpers/tmp.js';
import write from './helpers/write.js';

test('--replace overwrites the input file', async () => {
  const file = tmp('replace.css');
  await write(file, '.replace { color: red; }\n');

  const { error, stderr } = await cli([
    file,
    '--replace',
    '-u',
    path.resolve('test/fixtures/plugins/to-blue.mjs'),
  ]);

  expect(error, stderr).toBeFalsy();
  expect(await read(file)).toContain('color: blue');
});

test('--ext changes the output extension when using --dir', async () => {
  const outputDir = tmp();

  const { error, stderr } = await cli([
    'test/fixtures/a.css',
    '--dir',
    outputDir,
    '--ext',
    'min.css',
    '--no-map',
  ]);

  expect(error, stderr).toBeFalsy();
  expect(await read(path.join(outputDir, 'a.min.css'))).toBe(await read('test/fixtures/a.css'));
});

test('--map writes an external sourcemap with the postcss engine', async () => {
  const output = tmp('mapped.css');

  const { error, stderr } = await cli(['test/fixtures/a.css', '-o', output, '--map']);

  expect(error, stderr).toBeFalsy();
  expect(await fs.readFile(output, 'utf8')).toBeTruthy();
  expect(await fs.readFile(`${output}.map`, 'utf8')).toBeTruthy();
});
