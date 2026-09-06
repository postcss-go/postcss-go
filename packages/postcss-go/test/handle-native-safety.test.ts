import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { createNativeService, isNativeBridgeAvailable } from '../src/native.ts';

test.runIf(isNativeBridgeAvailable())(
  'native handle arguments, batch getters, and session failures are isolated',
  () => {
    const service = createNativeService();
    const addon = service.handleAddon!;
    const owner = addon.handleParseV2('a{x:y}');
    const { sessionId, rootId } = owner;
    try {
      expect(() => addon.handleTypeV2(0, rootId)).toThrow();
      expect(() => addon.handleGetFieldV2(sessionId, 0, 1)).toThrow();
      expect(() => addon.handleCloseCursorV2(sessionId, 999)).toThrow();
      const cursor = addon.handleOpenCursorV2(sessionId, rootId, true);
      const ids = new Uint32Array(1);
      expect(addon.handleCursorNextV2(sessionId, cursor, ids)).toBe(1);
      expect(() =>
        addon.handleCursorNextV2(sessionId, cursor, new Uint8Array(4) as unknown as Uint32Array),
      ).toThrow();
      expect(() =>
        addon.handleReadFieldsV2(sessionId, new Uint8Array(4) as unknown as Uint32Array, 1),
      ).toThrow();
      expect(() => addon.handleSetFieldsV2(sessionId, ids, 1, [])).toThrow(/length/);
      expect(() =>
        addon.handleSetFieldsV2(sessionId, new Uint8Array(4) as unknown as Uint32Array, 1, ['x']),
      ).toThrow();
      const values = Object.defineProperty([], '0', {
        get() {
          structuredClone(ids.buffer, { transfer: [ids.buffer] });
          return 'changed';
        },
      });
      expect(() => addon.handleSetFieldsV2(sessionId, ids, 1, values)).toThrow(/IDs changed/);
      expect(addon.handleStringifyV2(sessionId, rootId)).toBe('a{x:y}');
      addon.handleCloseCursorV2(sessionId, cursor);
      const huge = '中'.repeat(400_000);
      const detached = addon.handleNewDeclV2(sessionId, 'custom', huge);
      expect(addon.handleGetFieldV2(sessionId, detached, 1)).toBe(huge);
      addon.handleDisposeV2(sessionId, detached);
      expect(() => addon.handleGetFieldV2(sessionId, detached, 1)).toThrow();
    } finally {
      addon.handleCloseV2(sessionId);
      service.close();
    }
  },
);

test.runIf(isNativeBridgeAvailable())(
  'native finalizers reclaim unreachable sessions without closing retained owners',
  () => {
    const suffix =
      process.platform === 'linux' ? '-gnu' : process.platform === 'win32' ? '-msvc' : '';
    const addonPath = createRequire(import.meta.url).resolve(
      `@postcss-go/native-${process.platform}-${process.arch}${suffix}`,
    );
    const child = spawnSync(
      process.execPath,
      [
        '--expose-gc',
        '--eval',
        `
    const assert = require('node:assert/strict');
    const addon = require(${JSON.stringify(addonPath)});
    (async () => {
      const live = addon.handleParseV2('a{x:y}');
      for (let i = 0; i < 100; i++) addon.handleParseV2('b{x:y}');
      for (let i = 0; i < 100; i++) {
        global.gc();
        await new Promise(resolve => setTimeout(resolve, 10));
        if (addon.handleProtocolInfo().activeSessions === 1) break;
      }
      assert.equal(addon.handleProtocolInfo().activeSessions, 1);
      assert.equal(addon.handleStringifyV2(live.sessionId, live.rootId), 'a{x:y}');
      addon.handleCloseV2(live.sessionId);
      assert.equal(addon.handleProtocolInfo().activeSessions, 0);
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `,
      ],
      { encoding: 'utf8', timeout: 15000 },
    );
    expect(child.status, child.stderr).toBe(0);
  },
);
