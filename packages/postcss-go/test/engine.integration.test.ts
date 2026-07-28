import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

import cli from './helpers/cli.ts';
import tmp from './helpers/tmp.ts';
import read from './helpers/read.ts';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function waitForContent(file: string, content: string, timeout = 20000) {
  const deadline = Date.now() + timeout;

  return new Promise<void>((resolve, reject) => {
    const check = async () => {
      try {
        if ((await read(file)).includes(content)) {
          resolve();
          return;
        }
      } catch {
        // File may not exist yet.
      }

      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for ${file} to contain ${content}`));
        return;
      }

      setTimeout(check, 50);
    };

    void check();
  });
}

test.skipIf(process.env.COVERAGE_RUN === 'true')(
  'writes output with the Go engine by default',
  { timeout: 25000 },
  async () => {
    const output = tmp('output.css');
    const child = spawn(
      process.execPath,
      [
        path.join(packageRoot, 'bin/postcss-go.js'),
        'test/fixtures/a.css',
        '-o',
        output,
        '--no-map',
      ],
      { cwd: packageRoot },
    );

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    try {
      await waitForContent(output, 'color: red');
      expect(stderr).toBe('');
      expect(await read(output)).toContain('color: red');
    } finally {
      child.kill();
      await Promise.race([
        new Promise((resolve) => child.on('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
    }
  },
);

test('the Go engine runs --use plugins by default', async () => {
  const output = tmp('output.css');

  const { error, stderr } = await cli([
    'test/fixtures/a.css',
    '-o',
    output,
    '--no-map',
    '-u',
    path.resolve('test/fixtures/plugins/to-blue.mjs'),
  ]);

  expect(error, stderr).toBeFalsy();
  expect(await read(output)).toContain('color: blue');
});

test('the Go engine runs config plugins by default', async () => {
  const fixtureDir = 'test/fixtures/config';
  const output = path.resolve(tmp('output.css'));

  const { error, stderr } = await cli(['input.css', '-o', output, '--no-map'], fixtureDir);

  expect(error, stderr).toBeFalsy();
  expect(await read(output)).toContain('color: tomato');
});

test('the CLI recognizes a default parser delegate without a fallback', async () => {
  const fixtureDir = 'test/fixtures/config-parser';
  const output = path.resolve(tmp('output.css'));

  const { error, stderr } = await cli(['input.css', '-o', output, '--no-map'], fixtureDir);

  expect(error, stderr).toBeFalsy();
  expect(await read(output)).toContain('color: red');
});

test('the Go engine writes external sourcemaps by default', async () => {
  const output = tmp('output.css');

  const { error, stderr } = await cli(['test/fixtures/a.css', '-o', output, '--map']);

  expect(error, stderr).toBeFalsy();
  const css = await read(output);
  const map = JSON.parse(await read(`${output}.map`));
  expect(css).toContain('sourceMappingURL=output.css.map');
  expect(map.version).toBe(3);
  expect(map.sources[0]).toContain('a.css');
  expect(map.mappings).toBeTruthy();
});

test('the Go engine composes plugin sourcemaps back to the original CSS', async () => {
  const output = tmp('output.css');

  const { error, stderr } = await cli([
    'test/fixtures/a.css',
    '-o',
    output,
    '--map',
    '-u',
    path.resolve('test/fixtures/plugins/to-blue.mjs'),
  ]);

  expect(error, stderr).toBeFalsy();
  const map = JSON.parse(await read(`${output}.map`));
  expect(await read(output)).toContain('color: blue');
  expect(map.sourcesContent).toEqual([expect.stringContaining('color: red')]);
  expect(map.sources[0]).not.toMatch(/^[/\\]/);
});

test('the Go engine writes default inline sourcemaps', async () => {
  const output = tmp('output.css');

  const { error, stderr } = await cli(['test/fixtures/a.css', '-o', output]);

  expect(error, stderr).toBeFalsy();
  expect(await read(output)).toContain('sourceMappingURL=data:application/json;base64,');
});

test('the Go engine supports postcss.config.js map options', async () => {
  const fixtureDir = 'test/fixtures/config';
  const output = path.resolve(tmp('output.css'));

  const { error, stderr } = await cli(['input.css', '-o', output], fixtureDir);

  expect(error, stderr).toBeFalsy();
  expect(await read(output)).toContain('sourceMappingURL=data:application/json;base64,');
});

test('the Go engine supports explicit map: true in postcss.config.js', async () => {
  const fixtureDir = 'test/fixtures/config-map';
  const output = path.resolve(tmp('output.css'));

  const { error, stderr } = await cli(['input.css', '-o', output, '--no-map'], fixtureDir);

  expect(error, stderr).toBeFalsy();
  expect(await read(output)).toContain('sourceMappingURL=data:application/json;base64,');
});
