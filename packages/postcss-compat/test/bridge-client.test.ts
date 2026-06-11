import childProcess from 'node:child_process';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { expect, test } from 'vitest';

const require = createRequire(import.meta.url);

function withBridgeClient(responseLines, run) {
  const originalSpawn = childProcess.spawn;
  const originalReadSync = fs.readSync;

  const writes = [];
  let killed = false;
  let buffer = Buffer.from(responseLines.join(''), 'utf8');

  childProcess.spawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stdout.fd = 42;
    child.stderr = new EventEmitter();
    child.stdin = {
      write(chunk) {
        writes.push(chunk);
        return true;
      },
    };
    child.kill = () => {
      killed = true;
      child.emit('close');
    };
    return child;
  };

  fs.readSync = (fd, chunk, offset, length) => {
    expect(fd).toBe(42);
    const bytesRead = buffer.copy(chunk, offset, 0, Math.min(length, buffer.length));
    buffer = buffer.subarray(bytesRead);
    return bytesRead;
  };

  const bridgePath = require.resolve('../bridge-client.cjs');
  delete require.cache[bridgePath];
  const bridge = require(bridgePath);

  const restore = () => {
    bridge.close();
    delete require.cache[bridgePath];
    childProcess.spawn = originalSpawn;
    fs.readSync = originalReadSync;
  };

  return Promise.resolve()
    .then(() => run({ bridge, writes, wasKilled: () => killed }))
    .finally(restore);
}

test('bridge-client.cjs sends JSON-RPC requests through the go bridge', async () => {
  await withBridgeClient(
    [
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true, method: 'process', params: { css: '.a { color: red; }' } } })}\n`,
    ],
    ({ bridge, writes, wasKilled }) => {
      const result = bridge.callSync('process', { css: '.a { color: red; }' });
      expect(result).toEqual({
        ok: true,
        method: 'process',
        params: { css: '.a { color: red; }' },
      });
      expect(writes[0]).toMatch(/"method":"process"/);
      bridge.close();
      expect(wasKilled()).toBe(true);
    },
  );
});

test('bridge-client.cjs wraps bridge errors as CssSyntaxError', async () => {
  await withBridgeClient(
    [`${JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'syntax boom' } })}\n`],
    ({ bridge }) => {
      expect(() => bridge.callSync('parse', { css: '.a {' })).toThrowError(
        expect.objectContaining({
          name: 'CssSyntaxError',
          message: expect.stringMatching(/syntax boom/),
        }),
      );
    },
  );
});
