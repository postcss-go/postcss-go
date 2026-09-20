import { HANDLE_REQUIRED_CAPABILITIES } from '../src/generated/handle-protocol.ts';
import { expect, test, vi } from 'vitest';

import {
  HANDLE_FIELD_PROP,
  HANDLE_FIELD_VALUE,
  NativeHandleSession,
  createHandleDeclarationStub,
  hasNativeHandleBridge,
  type NativeHandleAddon,
} from '../src/handle-session.ts';
import { createNativeService, isNativeBridgeAvailable } from '../src/native.ts';

function mockAddon(overrides: Partial<NativeHandleAddon> = {}): NativeHandleAddon {
  return {
    handleProtocolInfo: () => ({
      major: 2,
      minor: 0,
      maxBatchSize: 4096,
      capabilities: new Uint32Array(HANDLE_REQUIRED_CAPABILITIES),
    }),
    handleParse: () => ({ sessionId: 1, rootId: 1 }),
    handleClose: () => {},
    handleType: () => 1,
    handleGetField: () => 'color',
    handleSetField: () => {},
    handleWalkDecls: (_session, _root, buffer) => {
      buffer[0] = 2;
      return 1;
    },
    handleOpenCursor: () => 1,
    handleCursorNext: (_session, _cursor, buffer) => {
      buffer[0] = 2;
      return 1;
    },
    handleCloseCursor: () => {},
    handleReadFields: () => ['color'],
    handleSetFields: () => {},
    handleStringify: () => 'a { color: red; }',
    handleNewDecl: () => 3,
    handleAppend: () => {},
    handleDispose: () => {},
    ...overrides,
  };
}

test('hasNativeHandleBridge rejects incomplete addons', () => {
  expect(hasNativeHandleBridge(null)).toBe(false);
  expect(hasNativeHandleBridge(undefined)).toBe(false);
  expect(hasNativeHandleBridge('addon')).toBe(false);
  expect(hasNativeHandleBridge({})).toBe(false);
  expect(
    hasNativeHandleBridge({
      handleParse: () => 1,
      handleStringify: () => '',
    }),
  ).toBe(false);
  expect(hasNativeHandleBridge(mockAddon())).toBe(true);
});

test('createHandleDeclarationStub allows prop, value, and important', () => {
  const stub = createHandleDeclarationStub('color', 'red');
  expect(stub.prop).toBe('color');
  expect(stub.value).toBe('red');
  expect(stub.important).toBe(false);
  stub.prop = 'background';
  stub.value = 'navy';
  stub.important = true;
  expect(stub.prop).toBe('background');
  expect(stub.value).toBe('navy');
  expect(stub.important).toBe(true);
  expect(Reflect.get(stub, Symbol.toStringTag)).toBeUndefined();
  expect(() => {
    (stub as { parent: unknown }).parent = null;
  }).toThrow(/parent/);
});

test('NativeHandleSession parses, reads, writes, walks, and closes', () => {
  const closed: number[] = [];
  const addon = mockAddon({
    handleParse: (css) => ({ sessionId: css === 'fail' ? 0 : 1, rootId: 7 }),
    handleClose: () => {
      closed.push(1);
    },
  });
  const session = new NativeHandleSession(addon, 8);
  expect(() => session.parse('fail')).toThrow(/handle parse failed/);
  expect(session.parse('.a { color: red; }')).toBe(7);
  expect(session.rootHandle).toBe(7);
  expect(session.getField(7, HANDLE_FIELD_PROP)).toBe('color');
  session.setField(7, HANDLE_FIELD_VALUE, 'navy');
  expect(session.walkDecls()).toBe(1);
  expect(session.walkBuffer[0]).toBe(2);
  expect(session.cursorWalkDecls()).toBe(1);
  expect(session.stringify()).toBe('a { color: red; }');
  expect(session.readFields(session.walkBuffer.subarray(0, 1), HANDLE_FIELD_PROP)).toEqual([
    'color',
  ]);
  session.setFields(session.walkBuffer.subarray(0, 1), HANDLE_FIELD_VALUE, ['navy']);
  session.close();
  session.close();
  expect(closed).toEqual([1]);
});

test.skipIf(!isNativeBridgeAvailable())('native handle session round-trips a stylesheet', () => {
  const service = createNativeService();
  expect(hasNativeHandleBridge(service.handleBridge)).toBe(true);
  const session = new NativeHandleSession(service.handleBridge!);
  const root = session.parse('.card { color: red; display: block; }');
  expect(session.rootHandle).toBe(root);
  const count = session.walkDecls(root);
  expect(count).toBe(2);
  const handles = session.walkBuffer.subarray(0, count);
  expect(session.readFields(handles, HANDLE_FIELD_PROP)).toEqual(['color', 'display']);
  session.setFields(handles, HANDLE_FIELD_VALUE, ['navy', 'flex']);
  expect(session.stringify(root)).toContain('color: navy');
  session.close();
  service.close();
});

test('sessions close exactly once per successful parse and reject use after close', () => {
  const close = vi.fn();
  const s = new NativeHandleSession(mockAddon({ handleClose: close }));
  s.close();
  expect(close).not.toHaveBeenCalled();
  s.parse('');
  s.parse('');
  s.close();
  s.close();
  expect(close).toHaveBeenCalledTimes(2);
  expect(() => s.stringify()).toThrow(/closed/);
  expect(() => new NativeHandleSession(mockAddon(), 0)).toThrow(RangeError);
  expect(
    () =>
      new NativeHandleSession(
        mockAddon({
          handleProtocolInfo: () => ({
            major: 1,
            minor: 0,
            maxBatchSize: 1,
            capabilities: new Uint32Array(HANDLE_REQUIRED_CAPABILITIES),
          }),
        }),
      ),
  ).toThrow(/protocol/);
});

test('cursor drains exact-sized pages and closes on invalid pages', () => {
  let offset = 0;
  const close = vi.fn();
  const addon = mockAddon({
    handleCloseCursor: close,
    handleCursorNext(_session, _cursor, buffer) {
      const ids = new Uint32Array([1, 2, 3, 4]);
      const chunk = ids.subarray(offset, offset + buffer.length);
      buffer.set(chunk);
      offset += chunk.length;
      return chunk.length;
    },
  });
  const s = new NativeHandleSession(addon, 2);
  s.parse('');
  expect(s.cursorWalkDecls()).toBe(4);
  expect(Array.from(s.walkBuffer.subarray(0, 4))).toEqual([1, 2, 3, 4]);
  expect(close).toHaveBeenCalledTimes(1);
  addon.handleCursorNext = () => -1;
  expect(() => s.cursorWalkDecls()).toThrow(/invalid/);
  expect(() => [...s.declarationBatches()]).toThrow(/invalid/);
  expect(close).toHaveBeenCalledTimes(3);
  s.close();
});

test.skipIf(!isNativeBridgeAvailable())(
  'native sessions isolate reentrant parses and large UTF-8 fields',
  () => {
    const service = createNativeService();
    const addon = service.handleBridge!;
    const a = new NativeHandleSession(addon, 1);
    const b = new NativeHandleSession(addon, 1);
    try {
      a.parse('a{x:one;y:two}');
      b.parse('b{x:three}');
      expect(a.walkDecls()).toBe(2);
      const ids = a.walkBuffer.subarray(0, 2);
      const huge = '中🙂'.repeat(210_000);
      a.setFields(ids, HANDLE_FIELD_VALUE, [huge, 'four']);
      expect(a.readFields(ids, HANDLE_FIELD_VALUE)).toEqual([huge, 'four']);
      expect(a.getField(ids[0], HANDLE_FIELD_VALUE)).toBe(huge);
      expect(a.stringify()).toContain(huge);
      b.close();
      a.setField(ids[0], HANDLE_FIELD_VALUE, huge + 'end');
      expect(a.getField(ids[0], HANDLE_FIELD_VALUE)).toBe(huge + 'end');
      expect(() =>
        a.setFields(new Uint32Array([ids[0], 0]), HANDLE_FIELD_VALUE, ['bad', 'bad']),
      ).toThrow();
      expect(a.getField(ids[0], HANDLE_FIELD_VALUE)).toBe(huge + 'end');
    } finally {
      a.close();
      b.close();
      service.close();
    }
  },
);

test.skipIf(!isNativeBridgeAvailable())(
  'native cursors do not truncate beyond 200000 declarations',
  () => {
    const service = createNativeService();
    const s = new NativeHandleSession(service.handleBridge!);
    try {
      s.parse('a{' + 'x:y;'.repeat(200_001) + '}');
      let count = 0;
      for (const batch of s.declarationBatches()) count += batch.length;
      expect(count).toBe(200_001);
    } finally {
      s.close();
      service.close();
    }
  },
);

test('protocol negotiation rejects malformed and throwing handshakes safely', () => {
  const valid = mockAddon().handleProtocolInfo();
  for (const info of [
    null,
    undefined,
    { ...valid, major: 3 },
    { ...valid, minor: -1 },
    { ...valid, minor: 0.5 },
    { ...valid, capabilities: new Uint32Array() },
    { ...valid, capabilities: [1] },
    { ...valid, maxBatchSize: 0 },
    { ...valid, maxBatchSize: 2 ** 32 },
  ]) {
    const addon = mockAddon({
      handleProtocolInfo: () => info as ReturnType<NativeHandleAddon['handleProtocolInfo']>,
    });
    expect(hasNativeHandleBridge(addon)).toBe(false);
    expect(() => new NativeHandleSession(addon)).toThrow(/incompatible/);
  }
  expect(
    hasNativeHandleBridge(
      mockAddon({
        handleProtocolInfo: () => {
          throw new Error('old addon');
        },
      }),
    ),
  ).toBe(false);
  expect(
    hasNativeHandleBridge(
      mockAddon({
        handleProtocolInfo: () => ({ ...valid, minor: 10 }),
      }),
    ),
  ).toBe(true);
});

test('negotiated batch limit bounds cursor pages and rejects oversized atomic writes', () => {
  let offset = 0;
  const ids = new Uint32Array([2, 3, 4, 5, 6]);
  const write = vi.fn();
  const read = vi.fn();
  const addon = mockAddon({
    handleProtocolInfo: () => ({
      major: 2,
      minor: 1,
      maxBatchSize: 2,
      capabilities: new Uint32Array(HANDLE_REQUIRED_CAPABILITIES),
    }),
    handleCursorNext(_session, _cursor, buffer) {
      expect(buffer.length).toBeLessThanOrEqual(2);
      const page = ids.subarray(offset, offset + buffer.length);
      buffer.set(page);
      offset += page.length;
      return page.length;
    },
    handleReadFields: read,
    handleSetFields: write,
  });
  const session = new NativeHandleSession(addon, 3);
  session.parse('');
  expect(session.cursorWalkDecls()).toBe(5);
  expect(session.walkBuffer.subarray(0, 5)).toEqual(ids);
  offset = 0;
  expect(Array.from(session.declarationBatches(), (batch) => [...batch])).toEqual([
    [2, 3],
    [4, 5],
    [6],
  ]);
  expect(() => session.setFields(ids, HANDLE_FIELD_VALUE, ['a', 'b', 'c', 'd', 'e'])).toThrow(
    /maximum/,
  );
  expect(() => session.readFields(ids, HANDLE_FIELD_VALUE)).toThrow(/maximum/);
  expect(write).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  session.close();
});

test('each required capability is negotiated independently, including newer minor addons', () => {
  const valid = mockAddon().handleProtocolInfo();
  for (const bit of [1, 2, 4, 8]) {
    const addon = mockAddon({
      handleProtocolInfo: () => ({
        ...valid,
        minor: 99,
        capabilities: new Uint32Array([HANDLE_REQUIRED_CAPABILITIES[0] & ~bit]),
      }),
    });
    expect(hasNativeHandleBridge(addon)).toBe(false);
  }
  expect(
    hasNativeHandleBridge(
      mockAddon({
        handleProtocolInfo: () => ({
          ...valid,
          capabilities: new Uint32Array([HANDLE_REQUIRED_CAPABILITIES[0] | 0x80000000]),
        }),
      }),
    ),
  ).toBe(true);
  expect(
    hasNativeHandleBridge(
      Object.defineProperty({}, 'handleProtocolInfo', {
        get() {
          throw new Error('getter');
        },
      }),
    ),
  ).toBe(false);
  expect(
    hasNativeHandleBridge(
      mockAddon({ handleProtocolInfo: () => ({ ...valid, minor: 0x100000000 }) }),
    ),
  ).toBe(false);
});

test('parse forwards source options and rejects malformed owner IDs without leaks', () => {
  const parse = vi.fn(() => ({ sessionId: 1, rootId: 1 }));
  const close = vi.fn();
  const session = new NativeHandleSession(mockAddon({ handleParse: parse, handleClose: close }));
  session.parse('a{}', { from: '/source.css', document: 'input', trackSource: true });
  expect(parse).toHaveBeenCalledWith(
    'a{}',
    JSON.stringify({ from: '/source.css', document: 'input', trackSource: true }),
  );
  session.close();
  for (const rootId of [0, -1, 0.5, NaN, Infinity, 0x100000000]) {
    parse.mockReturnValue({ sessionId: 1, rootId });
    expect(() => session.parse('a{}')).toThrow(/parse failed/);
    expect(session.rootHandle).toBe(0);
  }
  expect(close).toHaveBeenCalledTimes(7);
  parse.mockReturnValue({ sessionId: 0x100000000, rootId: 1 });
  expect(() => session.parse('a{}')).toThrow(/parse failed/);
  expect(close).toHaveBeenCalledTimes(7);
});
