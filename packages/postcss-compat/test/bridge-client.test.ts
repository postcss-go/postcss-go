import childProcess from 'node:child_process';
import { createRequire } from 'node:module';
import { expect, test } from 'vitest';

const require = createRequire(import.meta.url);

function withBridgeClient(response, run) {
  const originalSpawnSync = childProcess.spawnSync;
  const originalExecFileSync = childProcess.execFileSync;
  const calls = [];

  childProcess.execFileSync = () => Buffer.alloc(0);
  childProcess.spawnSync = (command, args, options) => {
    calls.push({ command, args, options });
    return {
      status: 0,
      stdout: Buffer.from(`${JSON.stringify(response)}\n`),
      stderr: Buffer.alloc(0),
    };
  };

  const bridgePath = require.resolve('../bridge-client.cjs');
  delete require.cache[bridgePath];
  const bridge = require(bridgePath);

  try {
    return run({ bridge, calls });
  } finally {
    bridge.close();
    delete require.cache[bridgePath];
    childProcess.spawnSync = originalSpawnSync;
    childProcess.execFileSync = originalExecFileSync;
  }
}

test('bridge-client.cjs builds one bridge binary and sends JSON-RPC requests', () => {
  withBridgeClient({ jsonrpc: '2.0', id: 1, result: { ok: true } }, ({ bridge, calls }) => {
    expect(bridge.callSync('process', { css: '.a { color: red; }' })).toEqual({ ok: true });
    expect(bridge.callSync('parse', { css: 'a{}' })).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[0].args).toEqual(['--single']);
    expect(calls[1].args).toEqual(['--single']);
  });
});

test('bridge-client.cjs preserves structured bridge errors', () => {
  withBridgeClient(
    {
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
