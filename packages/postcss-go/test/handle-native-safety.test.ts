import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { createNativeService, isNativeBridgeAvailable } from '../src/native.ts';

test.runIf(isNativeBridgeAvailable())(
  'native handle arguments, batch getters, and session failures are isolated',
  () => {
    const service = createNativeService();
    const addon = service.handleBridge!;
    const owner = addon.handleParse('a{x:y}');
    const { sessionId, rootId } = owner;
    try {
      expect(() => addon.handleType(0, rootId)).toThrow();
      expect(() => addon.handleGetField(sessionId, 0, 1)).toThrow();
      expect(() => addon.handleCloseCursor(sessionId, 999)).toThrow();
      const cursor = addon.handleOpenCursor(sessionId, rootId, true);
      const ids = new Uint32Array(1);
      expect(addon.handleCursorNext(sessionId, cursor, ids)).toBe(1);
      expect(() =>
        addon.handleCursorNext(sessionId, cursor, new Uint8Array(4) as unknown as Uint32Array),
      ).toThrow();
      expect(() =>
        addon.handleReadFields(sessionId, new Uint8Array(4) as unknown as Uint32Array, 1),
      ).toThrow();
      expect(() => addon.handleSetFields(sessionId, ids, 1, [])).toThrow(/length/);
      expect(() =>
        addon.handleSetFields(sessionId, new Uint8Array(4) as unknown as Uint32Array, 1, ['x']),
      ).toThrow();
      const values = Object.defineProperty([], '0', {
        get() {
          structuredClone(ids.buffer, { transfer: [ids.buffer] });
          return 'changed';
        },
      });
      expect(() => addon.handleSetFields(sessionId, ids, 1, values)).toThrow(/IDs changed/);
      expect(addon.handleStringify(sessionId, rootId)).toBe('a{x:y}');
      addon.handleCloseCursor(sessionId, cursor);
      const huge = '中'.repeat(400_000);
      const detached = addon.handleNewDecl(sessionId, 'custom', huge);
      expect(addon.handleGetField(sessionId, detached, 1)).toBe(huge);
      expect(
        JSON.parse(addon.handleReadSnapshots!(sessionId, new Uint32Array([detached])))[0].value,
      ).toBe(huge);
      expect(() =>
        addon.handleReadSnapshots!(sessionId, new Uint8Array(4) as unknown as Uint32Array),
      ).toThrow();
      expect(() => addon.handleReadSnapshots!(sessionId, new Uint32Array(4097))).toThrow();
      expect(() => addon.handleReadSnapshots!(sessionId, new Uint32Array([0]))).toThrow();
      addon.handleDispose(sessionId, detached);
      expect(() => addon.handleGetField(sessionId, detached, 1)).toThrow();
    } finally {
      addon.handleClose(sessionId);
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
      const live = addon.handleParse('a{x:y}');
      for (let i = 0; i < 100; i++) addon.handleParse('b{x:y}');
      for (let i = 0; i < 100; i++) {
        global.gc();
        await new Promise(resolve => setTimeout(resolve, 10));
        if (addon.handleProtocolInfo().activeSessions === 1) break;
      }
      assert.equal(addon.handleProtocolInfo().activeSessions, 1);
      assert.equal(addon.handleStringify(live.sessionId, live.rootId), 'a{x:y}');
      addon.handleClose(live.sessionId);
      assert.equal(addon.handleProtocolInfo().activeSessions, 0);
      const { SessionOwner } = await import(${JSON.stringify(new URL('../dist/handle-facade.js', import.meta.url).href)});
      let retained;
      function populate() {
        retained = new SessionOwner(addon, 'retained{x:y}').root.first.first;
        for (let i = 0; i < 100; i++) new SessionOwner(addon, 'temporary{x:y}').root.first;
      }
      populate();
      for (let i = 0; i < 100; i++) {
        global.gc();
        await new Promise(resolve => setTimeout(resolve, 10));
        if (addon.handleProtocolInfo().activeSessions === 1) break;
      }
      assert.equal(addon.handleProtocolInfo().activeSessions, 1);
      assert.equal(retained.parent.first, retained);
      assert.equal(retained.toString(), 'x:y');
      retained = undefined;
      for (let i = 0; i < 100; i++) {
        global.gc();
        await new Promise(resolve => setTimeout(resolve, 10));
        if (addon.handleProtocolInfo().activeSessions === 0) break;
      }
      assert.equal(addon.handleProtocolInfo().activeSessions, 0);
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `,
      ],
      { encoding: 'utf8', timeout: 15000 },
    );
    expect(child.status, child.stderr).toBe(0);
  },
);

test.runIf(isNativeBridgeAvailable())(
  'native errors retain call-local status and parse origin',
  () => {
    const addon = createNativeService().handleBridge!;
    const owner = addon.handleParse('a{x:y}');
    const other = addon.handleParse('b{x:z}', undefined);
    expect(() => addon.handleParse('a{}', {} as unknown as string)).toThrow(/options/);
    const failure = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return error as Error & { status: number };
      }
      throw new Error('expected native failure');
    };
    try {
      const cursor = addon.handleOpenCursor(owner.sessionId, owner.rootId, true);
      const ids = new Uint32Array(1);
      addon.handleCursorNext(owner.sessionId, cursor, ids);
      addon.handleCloseCursor(owner.sessionId, cursor);
      const invalid = failure(() => addon.handleGetField(owner.sessionId, 0, 1));
      expect(invalid.status).toBe(1);
      expect(failure(() => addon.handleGetField(other.sessionId, other.rootId, 1)).status).toBe(5);
      expect(failure(() => addon.handleCursorNext(owner.sessionId, cursor, ids)).status).toBe(6);
      expect(failure(() => addon.handleAppend(owner.sessionId, ids[0], owner.rootId)).status).toBe(
        4,
      );
      expect(
        failure(() => addon.handleAppend(owner.sessionId, owner.rootId, owner.rootId)).status,
      ).toBe(8);
      addon.handleDispose(owner.sessionId, ids[0]);
      expect(failure(() => addon.handleGetField(owner.sessionId, ids[0], 1)).status).toBe(2);
      const parse = failure(() =>
        addon.handleParse('a{', JSON.stringify({ from: '/fixtures/original.css' })),
      );
      expect(parse.status).toBe(7);
      expect(parse.message).toContain('/fixtures/original.css');
      for (const invalidOptions of ['', '{', 'null', '{} {}']) {
        expect(failure(() => addon.handleParse('a{}', invalidOptions)).status).toBe(10);
      }
      expect(failure(() => addon.handleParse('a{}', '{"unknown":true}')).status).toBe(10);
      expect(invalid.status).toBe(1);
      expect(invalid.message).toContain('invalid handle');
      for (const id of [-1, 0.5, NaN, Infinity, 0x100000000 + other.sessionId]) {
        expect(() => addon.handleClose(id)).toThrow();
        expect(() => addon.handleType(other.sessionId, id)).toThrow();
      }
      expect(addon.handleStringify(other.sessionId, other.rootId)).toBe('b{x:z}');
      addon.handleClose(owner.sessionId);
      expect(failure(() => addon.handleType(owner.sessionId, owner.rootId)).status).toBe(3);
    } finally {
      addon.handleClose(owner.sessionId);
      addon.handleClose(other.sessionId);
    }
  },
);
