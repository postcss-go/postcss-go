import childProcess from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, test } from 'vitest';

const require = createRequire(import.meta.url);

afterEach(() => {
  delete process.env.POSTCSS_GO_COMPAT_BRIDGE_BIN;
});

function withBridgeClient(options, run) {
  const { response, responses, readErrorOnce, writeError, envBinary } = options;

  const originalSpawn = childProcess.spawn;
  const originalExecFileSync = childProcess.execFileSync;
  const originalWriteSync = fs.writeSync;
  const originalReadSync = fs.readSync;
  const calls = [];
  const queue = (responses ?? (response === undefined ? [] : [response])).map((item) =>
    Buffer.from(`${typeof item === 'string' ? item : JSON.stringify(item)}\n`),
  );
  let queueIndex = 0;
  let outputOffset = 0;
  let threwReadError = false;
  let killed = false;

  if (envBinary) {
    process.env.POSTCSS_GO_COMPAT_BRIDGE_BIN = envBinary;
  }

  childProcess.execFileSync = () => Buffer.alloc(0);
  childProcess.spawn = (command, args, spawnOptions) => {
    calls.push({ command, args, options: spawnOptions });
    return {
      stdin: { _handle: { fd: 41 }, unref() {} },
      stdout: { _handle: { fd: 42 }, unref() {} },
      stderr: { unref() {} },
      unref() {},
      kill() {
        killed = true;
      },
    };
  };
  fs.writeSync = () => {
    if (writeError) throw writeError;
    return 0;
  };
  fs.readSync = (fd, buffer, offset, length) => {
    if (fd !== 42) return originalReadSync(fd, buffer, offset, length, null);
    if (readErrorOnce && !threwReadError) {
      threwReadError = true;
      const error = new Error('resource temporarily unavailable');
      error.code = readErrorOnce;
      throw error;
    }
    if (queueIndex >= queue.length) {
      throw new Error('unexpected extra read from mocked bridge stdout');
    }
    const output = queue[queueIndex];
    buffer[offset] = output[outputOffset++];
    if (outputOffset >= output.length) {
      queueIndex += 1;
      outputOffset = 0;
    }
    return 1;
  };

  const bridgePath = require.resolve('../bridge-client.cjs');
  delete require.cache[bridgePath];
  const bridge = require(bridgePath);

  try {
    return run({ bridge, calls, getKilled: () => killed });
  } finally {
    bridge.close();
    delete require.cache[bridgePath];
    childProcess.spawn = originalSpawn;
    childProcess.execFileSync = originalExecFileSync;
    fs.writeSync = originalWriteSync;
    fs.readSync = originalReadSync;
  }
}

test('bridge-client.cjs builds one bridge binary and sends JSON-RPC requests', () => {
  withBridgeClient(
    {
      responses: [
        { jsonrpc: '2.0', id: 1, result: { ok: true } },
        { jsonrpc: '2.0', id: 2, result: { ok: true } },
      ],
    },
    ({ bridge, calls }) => {
      expect(bridge.callSync('process', { css: '.a { color: red; }' })).toEqual({ ok: true });
      expect(bridge.callSync('parse', { css: 'a{}' })).toEqual({ ok: true });
      expect(calls).toHaveLength(1);
      expect(calls[0].args).toEqual(['--single']);
    },
  );
});

test('bridge-client.cjs reuses POSTCSS_GO_COMPAT_BRIDGE_BIN when set', () => {
  const envBinary = path.join(os.tmpdir(), 'postcss-go-compat-bridge-bin');
  withBridgeClient(
    {
      response: { jsonrpc: '2.0', id: 1, result: { ok: true } },
      envBinary,
    },
    ({ bridge, calls }) => {
      expect(bridge.callSync('parse', { css: 'a{}' })).toEqual({ ok: true });
      expect(calls).toHaveLength(1);
      expect(calls[0].command).toBe(envBinary);
    },
  );
});

test('bridge-client.cjs retries stdout reads after EAGAIN', () => {
  withBridgeClient(
    {
      response: { jsonrpc: '2.0', id: 1, result: { ok: true } },
      readErrorOnce: 'EAGAIN',
    },
    ({ bridge }) => {
      expect(bridge.callSync('parse', { css: 'a{}' })).toEqual({ ok: true });
    },
  );
});

test('bridge-client.cjs wraps invalid JSON bridge output', () => {
  withBridgeClient({ responses: ['{not-json'] }, ({ bridge, getKilled }) => {
    expect(() => bridge.callSync('parse', { css: 'a{}' })).toThrowError(
      /postcss-go bridge returned invalid JSON/,
    );
    expect(getKilled()).toBe(true);
  });
});

test('bridge-client.cjs rethrows non-JSON transport errors after killing the process', () => {
  const boom = new Error('stdin broken');
  withBridgeClient(
    {
      response: { jsonrpc: '2.0', id: 1, result: { ok: true } },
      writeError: boom,
    },
    ({ bridge, getKilled }) => {
      expect(() => bridge.callSync('parse', { css: 'a{}' })).toThrow(boom);
      expect(getKilled()).toBe(true);
    },
  );
});

test('bridge-client.cjs preserves structured bridge errors', () => {
  withBridgeClient(
    {
      response: {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32000,
          message: 'input.css:2:4: syntax boom',
          name: 'CssSyntaxError',
          reason: 'syntax boom',
          line: 2,
          column: 4,
          file: 'input.css',
        },
      },
    },
    ({ bridge }) => {
      expect(() => bridge.callSync('parse', { css: '.a {' })).toThrowError(
        expect.objectContaining({
          name: 'CssSyntaxError',
          reason: 'syntax boom',
          line: 2,
          column: 4,
          file: 'input.css',
        }),
      );
    },
  );
});

test('bridge-client.cjs createError fills input metadata and file URLs', () => {
  withBridgeClient({ response: { jsonrpc: '2.0', id: 1, result: {} } }, ({ bridge }) => {
    const fromPath = bridge.createError({
      message: 'boom',
      input: {
        column: 3,
        file: 'input.css',
        line: 1,
        offset: 2,
        source: '.a {',
        sourceMapPresent: false,
      },
    });
    expect(fromPath.input).toEqual({
      column: 3,
      endColumn: undefined,
      endLine: undefined,
      endOffset: undefined,
      file: 'input.css',
      line: 1,
      offset: 2,
      source: '.a {',
      sourceMapPresent: false,
      url: pathToFileURL('input.css').href,
    });

    const alreadyURL = 'file:///tmp/input.css';
    const fromURL = bridge.createError({
      message: 'boom',
      input: {
        column: 1,
        file: alreadyURL,
        line: 1,
        offset: 0,
        source: 'a{}',
        sourceMapPresent: true,
      },
    });
    expect(fromURL.input.url).toBe(alreadyURL);

    const withoutFile = bridge.createError({
      message: 'boom',
      input: {
        column: 1,
        line: 1,
        offset: 0,
        source: 'a{}',
        sourceMapPresent: false,
      },
    });
    expect(withoutFile.input.url).toBeUndefined();
  });
});
