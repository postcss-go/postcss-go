import { expect, test, vi } from 'vitest';

import {
  HANDLE_FIELD_PROP,
  HANDLE_FIELD_VALUE,
  HandleDeclarationUnsupportedError,
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
      capabilities: new Uint32Array([1]),
    }),
    handleParseV2: () => ({ sessionId: 1, rootId: 1 }),
    handleCloseV2: () => {},
    handleTypeV2: () => 1,
    handleGetFieldV2: () => 'color',
    handleSetFieldV2: () => {},
    handleWalkDeclsV2: (_session, _root, buffer) => {
      buffer[0] = 2;
      return 1;
    },
    handleOpenCursorV2: () => 1,
    handleCursorNextV2: (_session, _cursor, buffer) => {
      buffer[0] = 2;
      return 1;
    },
    handleCloseCursorV2: () => {},
    handleReadFieldsV2: () => ['color'],
    handleSetFieldsV2: () => {},
    handleStringifyV2: () => 'a { color: red; }',
    handleNewDeclV2: () => 3,
    handleAppendV2: () => {},
    handleDisposeV2: () => {},
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
      handleParseV2: () => 1,
      handleStringifyV2: () => '',
    }),
  ).toBe(false);
  expect(hasNativeHandleBridge(mockAddon())).toBe(true);
});

test('createHandleDeclarationStub only allows prop and value', () => {
  const stub = createHandleDeclarationStub('color', 'red');
  expect(stub.prop).toBe('color');
  expect(stub.value).toBe('red');
  stub.prop = 'background';
  stub.value = 'navy';
  expect(stub.prop).toBe('background');
  expect(stub.value).toBe('navy');
  expect(Reflect.get(stub, Symbol.toStringTag)).toBeUndefined();
  expect(() => stub.important).toThrow(HandleDeclarationUnsupportedError);
  expect(() => {
    stub.important = true;
  }).toThrow(HandleDeclarationUnsupportedError);
  expect(() => {
    (stub as { parent: unknown }).parent = null;
  }).toThrow(/parent/);
});

test('NativeHandleSession parses, reads, writes, walks, and closes', () => {
  const closed: number[] = [];
  const addon = mockAddon({
    handleParseV2: (css) => ({ sessionId: css === 'fail' ? 0 : 1, rootId: 7 }),
    handleCloseV2: () => {
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
  expect(hasNativeHandleBridge(service.handleAddon)).toBe(true);
  const session = new NativeHandleSession(service.handleAddon!);
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
  const s = new NativeHandleSession(mockAddon({ handleCloseV2: close }));
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
            capabilities: new Uint32Array([1]),
          }),
        }),
      ),
  ).toThrow(/protocol/);
});

test('cursor drains exact-sized pages and closes on invalid pages', () => {
  let offset = 0;
  const close = vi.fn();
  const addon = mockAddon({
    handleCloseCursorV2: close,
    handleCursorNextV2(_session, _cursor, buffer) {
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
  addon.handleCursorNextV2 = () => -1;
  expect(() => s.cursorWalkDecls()).toThrow(/invalid/);
  expect(() => [...s.declarationBatches()]).toThrow(/invalid/);
  expect(close).toHaveBeenCalledTimes(3);
  s.close();
});

test.skipIf(!isNativeBridgeAvailable())(
  'native sessions isolate reentrant parses and large UTF-8 fields',
  () => {
    const service = createNativeService();
    const addon = service.handleAddon!;
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
    const s = new NativeHandleSession(service.handleAddon!);
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
