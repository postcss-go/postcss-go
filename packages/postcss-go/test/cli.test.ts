import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

import cli from './helpers/cli.ts';
import tmp from './helpers/tmp.ts';
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

function waitForContent(file: string, content: string, timeout = 10000) {
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

function waitForStreamContent(
  stream: NodeJS.ReadableStream,
  content: string,
  timeout = 10000,
  initialOutput = '',
) {
  const deadline = Date.now() + timeout;
  let output = initialOutput;

  return new Promise<void>((resolve, reject) => {
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
    const onData = (chunk: Buffer | string) => {
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

test('works with defaults', async () => {
  const output = tmp('output.css');

  const { error, stderr } = await cli(['test/fixtures/a.css', '-o', output, '--no-map']);

  expect(error, stderr).toBeFalsy();
  expect((await read(output)).trim()).toBe((await read('test/fixtures/a.css')).trim());
});

test('writes to stdout by default', async () => {
  const { error, stdout, stderr } = await cli(['test/fixtures/a.css', '--no-map']);

  expect(error, stderr).toBeFalsy();
  expect(stdout).toContain('color: red');
});

test('reports the processing backend in verbose mode', async () => {
  const { error, stderr } = await cli(['test/fixtures/a.css', '--no-map', '--verbose']);

  expect(error, stderr).toBeFalsy();
  expect(stderr).toContain('Backend: native (native addon available)');
  expect(stderr).toMatch(/Backend: native\b/);
});

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

test('--use accepts plugins exported as objects', async () => {
  const output = tmp('teal-output.css');

  const { error, stderr } = await cli([
    'test/fixtures/a.css',
    '-o',
    output,
    '--no-map',
    '-u',
    path.resolve('test/fixtures/plugins/to-teal.mjs'),
  ]);

  expect(error, stderr).toBeFalsy();
  expect(await read(output)).toContain('color: teal');
});

test('rejects parser, syntax, and stringifier delegates instead of ignoring them', async () => {
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

  expect(error).toBeTruthy();
  expect(stderr).toContain('UnsupportedSyntaxError');
});

test('rejects the removed --engine option', async () => {
  const { error, stderr } = await cli(['test/fixtures/a.css', '--no-map', '--engine', 'go']);

  expect(error).toBeTruthy();
  expect(stderr).toContain('Unknown argument: engine');
});

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
    child.kill('SIGKILL');
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
    child.kill('SIGKILL');
    await Promise.race([
      new Promise((resolve) => child.on('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
  }
}, 15000);

test('watch mode exits cleanly on SIGINT', async () => {
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

    child.kill('SIGINT');
    const exit = await Promise.race([
      new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.on('exit', (code, signal) => resolve({ code, signal }));
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);

    expect(exit, `watch process did not exit after SIGINT\nstderr:\n${stderr}`).not.toBeNull();
    expect(exit?.signal).toBeNull();
    expect(exit?.code).toBe(0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
}, 15000);

test('watch mode exits cleanly when stdin ends', async () => {
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
      stdio: ['pipe', 'pipe', 'pipe'],
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

    child.stdin?.end();
    const exit = await Promise.race([
      new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.on('exit', (code, signal) => resolve({ code, signal }));
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);

    expect(exit, `watch process did not exit after stdin end\nstderr:\n${stderr}`).not.toBeNull();
    expect(exit?.signal).toBeNull();
    expect(exit?.code).toBe(0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
}, 15000);
