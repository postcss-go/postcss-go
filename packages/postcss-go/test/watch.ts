import fs from 'node:fs/promises';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'url';
import { expect, test } from 'vitest';

import read from './helpers/read.ts';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function createWatchFixture() {
  const dir = path.resolve(packageRoot, 'test/fixtures/.tmp', randomUUID());
  return {
    dir,
    input: path.join(dir, 'input.css'),
    output: path.join(dir, 'output.css'),
  };
}

function waitForContent(file, content, timeout = 10000) {
  const deadline = Date.now() + timeout;

  return new Promise((resolve, reject) => {
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

function waitForStreamContent(stream, content, timeout = 10000, initialOutput = '') {
  const deadline = Date.now() + timeout;
  let output = initialOutput;

  return new Promise((resolve, reject) => {
    const check = () => {
      if (output.includes(content)) {
        cleanup();
        resolve();
        return;
      }

      if (Date.now() >= deadline) {
        cleanup();
        reject(new Error(`Timed out waiting for stream to contain ${content}`));
      }
    };
    const onData = (chunk) => {
      output += chunk.toString();
      check();
    };
    const onEnd = () => {
      cleanup();
      reject(new Error(`Stream ended before containing ${content}`));
    };
    const timer = setInterval(check, 50);
    const cleanup = () => {
      clearInterval(timer);
      stream.off('data', onData);
      stream.off('end', onEnd);
    };

    stream.on('data', onData);
    stream.on('end', onEnd);
    check();
  });
}

test('watch mode recompiles when input changes', async () => {
  const { input, output } = createWatchFixture();
  await fs.mkdir(path.dirname(input), { recursive: true });
  await fs.writeFile(input, '.a { color: red; }');

  const child = spawn(
    'node',
    [
      path.join(packageRoot, 'bin/postcss-go.js'),
      input,
      '-o',
      output,
      '--watch',
      '--poll',
      '--verbose',
      '--no-map',
    ],
    {
      cwd: packageRoot,
      env: { ...process.env, FORCE_IS_TTY: 'true' },
    },
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForContent(output, 'color: red').catch((error) => {
      throw new Error(`${error.message}\nchild stderr:\n${stderr}`);
    });
    await waitForStreamContent(child.stderr, 'Waiting for file changes...', 10000, stderr);

    await fs.writeFile(input, '.a { color: blue; }');
    await waitForContent(output, 'color: blue');
    expect(await read(output)).not.toContain('color: red');
  } finally {
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.on('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
  }
}, 15000);

test('watch mode recompiles when input changes without updating mtime', async () => {
  const { input, output } = createWatchFixture();
  await fs.mkdir(path.dirname(input), { recursive: true });
  await fs.writeFile(input, '.a { color: red; }');

  const child = spawn(
    'node',
    [
      path.join(packageRoot, 'bin/postcss-go.js'),
      input,
      '-o',
      output,
      '--watch',
      '--poll',
      '--verbose',
      '--no-map',
    ],
    {
      cwd: packageRoot,
      env: { ...process.env, FORCE_IS_TTY: 'true' },
    },
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForContent(output, 'color: red').catch((error) => {
      throw new Error(`${error.message}\nchild stderr:\n${stderr}`);
    });
    await waitForStreamContent(child.stderr, 'Waiting for file changes...', 10000, stderr);

    const { atime, mtime } = await fs.stat(input);
    await fs.writeFile(input, '.a { color: blue; }');
    await fs.utimes(input, atime, mtime);

    await waitForContent(output, 'color: blue');
    expect(await read(output)).not.toContain('color: red');
  } finally {
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.on('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
  }
}, 15000);
