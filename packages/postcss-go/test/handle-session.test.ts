import { expect, test } from 'vitest';

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
    handleParse: () => 1,
    handleClose: () => {},
    handleType: () => 1,
    handleGetField: () => 'color',
    handleSetField: () => {},
    handleWalkDecls: (_root, buffer) => {
      buffer[0] = 2;
      return 1;
    },
    handleOpenCursor: () => 1,
    handleCursorNext: (_cursor, buffer) => {
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
    handleParse: (css) => (css === 'fail' ? 0 : 7),
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
