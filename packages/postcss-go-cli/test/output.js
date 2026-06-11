import test from 'ava';
import fs from 'node:fs/promises';
import path from 'path';

import cli from './helpers/cli.js';
import read from './helpers/read.js';
import tmp from './helpers/tmp.js';
import write from './helpers/write.js';

test('--replace overwrites the input file', async (t) => {
  const file = tmp('replace.css');
  await write(file, '.replace { color: red; }\n');

  const { error, stderr } = await cli([
    file,
    '--replace',
    '-u',
    path.resolve('test/fixtures/plugins/to-blue.mjs'),
  ]);

  t.falsy(error, stderr);
  t.true((await read(file)).includes('color: blue'));
});

test('--ext changes the output extension when using --dir', async (t) => {
  const outputDir = tmp();

  const { error, stderr } = await cli([
    'test/fixtures/a.css',
    '--dir',
    outputDir,
    '--ext',
    'min.css',
    '--no-map',
  ]);

  t.falsy(error, stderr);
  t.is(await read(path.join(outputDir, 'a.min.css')), await read('test/fixtures/a.css'));
});

test('--map writes an external sourcemap with the postcss engine', async (t) => {
  const output = tmp('mapped.css');

  const { error, stderr } = await cli(['test/fixtures/a.css', '-o', output, '--map']);

  t.falsy(error, stderr);
  t.truthy(await fs.readFile(output, 'utf8'));
  t.truthy(await fs.readFile(`${output}.map`, 'utf8'));
});
