import path from 'path';
import { expect, test } from 'vitest';

import { SyncBackendUnavailableError, UnsupportedAstNodeError } from '../src/errors.ts';
import cli from './helpers/cli.ts';

const fixtureDir = path.resolve('test/fixtures/errors');

test('SyncBackendUnavailableError explains the missing sync backend', () => {
  const error = new SyncBackendUnavailableError();

  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe('SyncBackendUnavailableError');
  expect(error.message).toContain('Node N-API backend');
  expect(error.message).toContain('WASM Worker');
});

test('WasmWorkerError preserves its stable name', async () => {
  const { WasmWorkerError } = await import('../src/wasm/errors.ts');
  const error = new WasmWorkerError('classic Worker required');
  expect(error.name).toBe('WasmWorkerError');
  expect(error.message).toBe('classic Worker required');
});

test('errorFromWasmDto rebuilds CssSyntaxError metadata from the Worker DTO', async () => {
  const { errorFromWasmDto } = await import('../src/wasm/errors.ts');
  const { CssSyntaxError } = await import('../src/errors.ts');
  const error = errorFromWasmDto({
    name: 'CssSyntaxError',
    message: 'CssSyntaxError: a.css:1:2: Unclosed block',
    reason: 'Unclosed block',
    line: 1,
    column: 2,
    file: 'a.css',
    source: '.a {',
    input: { source: '.a {', file: 'a.css', line: 1, column: 2, offset: 1 },
  });

  expect(error).toBeInstanceOf(CssSyntaxError);
  expect(error).toMatchObject({
    name: 'CssSyntaxError',
    reason: 'Unclosed block',
    line: 1,
    column: 2,
    file: 'a.css',
  });
});

test('errorFromWasmDto returns WasmWorkerError instances for transport failures', async () => {
  const { WasmWorkerError, errorFromWasmDto } = await import('../src/wasm/errors.ts');
  const unnamed = errorFromWasmDto({ message: 'handler unavailable' });
  expect(unnamed).toBeInstanceOf(WasmWorkerError);
  expect(unnamed.name).toBe('WasmWorkerError');

  const named = errorFromWasmDto({ message: 'boom', name: 'WasmWorkerError' });
  expect(named).toBeInstanceOf(WasmWorkerError);
});

test('UnsupportedAstNodeError names the custom AST node type', () => {
  const error = new UnsupportedAstNodeError('word');

  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe('UnsupportedAstNodeError');
  expect(error.message).toContain('"word"');
  expect(error.message).toContain('backend boundary');
});

test('fails when config sets from/to options', async () => {
  const { error, stderr } = await cli(['input.css', '--no-map'], fixtureDir);

  expect(error).toBeTruthy();
  expect(stderr).toContain(
    'Config Error: Can not set from or to options in config file, use CLI arguments instead',
  );
});

test('fails when stdin is empty', async () => {
  const { error, stderr } = await cli([], fixtureDir, { stdin: '' });

  expect(error).toBeTruthy();
  expect(stderr).toContain('Input Error: Did not receive any STDIN');
});

test('watch mode exits on invalid config errors', async () => {
  const { error, stderr, code } = await cli(
    ['input.css', '-o', 'output.css', '--watch', '--no-map'],
    fixtureDir,
    {
      env: { FORCE_IS_TTY: 'true' },
      timeout: 1000,
    },
  );

  expect(error).toBeTruthy();
  expect(code).toBe(1);
  expect(stderr).toContain(
    'Config Error: Can not set from or to options in config file, use CLI arguments instead',
  );
});
