import { afterEach, expect, test, vi } from 'vitest';

import {
  createDefaultAsyncService,
  createNativeService,
  getDefaultAsyncBackendCapabilities,
  installNativeSyncCssRuntime,
  isNativeAsyncBridgeAvailable,
  isNativeBridgeAvailable,
  NativePostcssGoService,
} from '../src/native.ts';
import {
  AtRule,
  parseCssSync,
  Root,
  Rule,
  setSyncCssRuntime,
  stringifyCssSync,
} from '../src/ast.ts';
import {
  HANDLE_PROTOCOL_MAJOR,
  HANDLE_REQUIRED_CAPABILITIES,
} from '../src/generated/handle-protocol.ts';
import {
  AsyncBackendUnavailableError,
  AsyncPluginError,
  CssSyntaxError,
  SyncBackendUnavailableError,
} from '../src/errors.ts';

const originalDisableNative = process.env.POSTCSS_GO_DISABLE_NATIVE;

function mockHandleAddon(overrides: Record<string, unknown> = {}) {
  return {
    handleProtocolInfo: () => ({
      major: HANDLE_PROTOCOL_MAJOR,
      minor: 4,
      maxBatchSize: 4096,
      capabilities: new Uint32Array(HANDLE_REQUIRED_CAPABILITIES),
    }),
    handleParse: () => ({ sessionId: 1, rootId: 1 }),
    handleClose: () => {},
    handleType: () => 1,
    handleGetField: () => '',
    handleSetField: () => {},
    handleWalkDecls: () => 0,
    handleOpenCursor: () => 1,
    handleCursorNext: () => 0,
    handleCloseCursor: () => {},
    handleReadFields: () => [],
    handleSetFields: () => {},
    handleStringify: () => '.a{}',
    handleNewDecl: () => 2,
    handleAppend: () => {},
    handleDispose: () => {},
    ...overrides,
  };
}

afterEach(() => {
  if (originalDisableNative === undefined) delete process.env.POSTCSS_GO_DISABLE_NATIVE;
  else process.env.POSTCSS_GO_DISABLE_NATIVE = originalDisableNative;
});

test.runIf(isNativeAsyncBridgeAvailable())(
  'default async service prefers worker-backed native',
  async () => {
    const service = createDefaultAsyncService();

    expect(service.capabilities).toMatchObject({
      backend: 'native',
      backendWorkOffMainThread: true,
    });
    expect(getDefaultAsyncBackendCapabilities()).toMatchObject({ backend: 'native' });
    await service.close();
  },
);

test('missing async native reports the required backend as unavailable', () => {
  process.env.POSTCSS_GO_DISABLE_NATIVE = '1';

  expect(() => createDefaultAsyncService()).toThrow(AsyncBackendUnavailableError);
  expect(getDefaultAsyncBackendCapabilities()).toBeNull();
});

test('musl does not probe glibc or local native addons', async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  if (!platform) throw new Error('process.platform descriptor is unavailable');

  const getReport = vi.spyOn(process.report, 'getReport').mockReturnValue({ header: {} } as never);
  Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });

  try {
    vi.resetModules();
    const native = await import('../src/native.ts');

    expect(native.isNativeAsyncBridgeAvailable()).toBe(false);
  } finally {
    Object.defineProperty(process, 'platform', platform);
    getReport.mockRestore();
    vi.resetModules();
  }
});

test('non-syntax native failures do not trigger parser error reconstruction', () => {
  const nativeError = new Error('source map could not be loaded');
  const service = new NativePostcssGoService({
    noWork() {
      throw nativeError;
    },
  } as never);

  expect(() => service.processSync('.invalid {')).toThrow(nativeError);
});

test('rejects invalid noWork JSON', () => {
  const service = new NativePostcssGoService({
    noWork() {
      return 'not-json';
    },
  } as never);

  expect(() => service.processSync('.a{}')).toThrow();
});

test('createNativeService fails when the addon is disabled', () => {
  process.env.POSTCSS_GO_DISABLE_NATIVE = '1';
  expect(() => createNativeService()).toThrow(/native addon is unavailable/);
});

test('syntax-prefixed native errors rebuild structured CssSyntaxError metadata', () => {
  const syntax = new Error(
    'postcss-go:css-syntax:{"name":"CssSyntaxError","reason":"Unexpected }","line":1,"column":4}',
  );
  const service = new NativePostcssGoService(
    mockHandleAddon({
      handleParse() {
        throw syntax;
      },
    }) as never,
  );

  expect(() => service.parseSync('a {')).toThrow(CssSyntaxError);
  try {
    service.parseSync('a {');
  } catch (error) {
    expect(error).toMatchObject({
      name: 'CssSyntaxError',
      reason: 'Unexpected }',
      line: 1,
      column: 4,
      source: 'a {',
    });
  }
});

test('plain syntax-prefixed native errors become CssSyntaxError without a JS parser replay', () => {
  const service = new NativePostcssGoService(
    mockHandleAddon({
      handleParse() {
        throw new Error('postcss-go:css-syntax: Unexpected }');
      },
    }) as never,
  );

  expect(() => service.parseSync('a {')).toThrow(CssSyntaxError);
  expect(() => service.parseSync('a {')).toThrow(/Unexpected }/);
});

test('invalid syntax-prefixed JSON still becomes CssSyntaxError', () => {
  const service = new NativePostcssGoService(
    mockHandleAddon({
      handleParse() {
        throw new Error('postcss-go:css-syntax:{not-json');
      },
    }) as never,
  );

  expect(() => service.parseSync('.a{}')).toThrow(CssSyntaxError);
  expect(() => service.parseSync('.a{}')).toThrow(/not-json/);
});

test('sync map.annotation thenables are rejected as async plugins', () => {
  const service = new NativePostcssGoService({
    stringify() {
      return JSON.stringify({ css: '.a{}' });
    },
  } as never);

  expect(() =>
    service.stringifyResultSync(
      { type: 'root', nodes: [] },
      {
        map: {
          annotation: async () => 'out.css.map',
        },
      },
    ),
  ).toThrow(AsyncPluginError);
});

test('sync noWork map.annotation thenables are rejected as async plugins', () => {
  const service = new NativePostcssGoService({
    noWork() {
      return JSON.stringify({ css: '.a{}' });
    },
  } as never);

  expect(() =>
    service.noWorkSync('.a{}', {
      map: {
        annotation: async () => 'out.css.map',
      },
    }),
  ).toThrow(AsyncPluginError);
});

test.runIf(isNativeAsyncBridgeAvailable())(
  'async stringify annotation callbacks are awaited',
  async () => {
    const service = createNativeService();
    try {
      const result = await service.stringifyResult(service.parseSync('.a{}').root, {
        to: 'out.css',
        map: {
          annotation: async () => 'generated.css.map',
        },
      });
      expect(result.css).toContain('.a');
    } finally {
      await service.close();
    }
  },
);

test('async noWork annotation callbacks are awaited', async () => {
  const service = new NativePostcssGoService({
    async noWorkAsync() {
      return JSON.stringify({ css: '.a{}' });
    },
  } as never);

  const result = await service.noWork('.a{}', {
    to: 'out.css',
    map: {
      annotation: async () => 'generated.css.map',
    },
  });
  expect(result.css).toBe('.a{}');
});

test.runIf(isNativeBridgeAvailable())(
  'processSync with annotation callbacks stringifies through the live path',
  () => {
    const service = createNativeService();
    try {
      const result = service.processSync('.a{}', {
        to: 'out.css',
        map: { annotation: () => 'out.css.map' },
      });
      expect(result.css).toContain('.a');
      expect(result.backend).toBe('native');
    } finally {
      service.close();
    }
  },
);

test.runIf(isNativeAsyncBridgeAvailable())(
  'process with annotation callbacks stringifies through the live async path',
  async () => {
    const service = createNativeService();
    try {
      const result = await service.process('.a{}', {
        to: 'out.css',
        map: { annotation: async () => 'out.css.map' },
      });
      expect(result.css).toContain('.a');
      expect(result.backend).toBe('native');
    } finally {
      await service.close();
    }
  },
);

test('parseCssSync and stringifyCssSync throw without an installed N-API runtime', () => {
  setSyncCssRuntime(undefined);
  try {
    expect(() => parseCssSync('.a{}')).toThrow(SyncBackendUnavailableError);
    expect(() => stringifyCssSync(new Root())).toThrow(SyncBackendUnavailableError);
  } finally {
    installNativeSyncCssRuntime();
  }
});

test('installNativeSyncCssRuntime clears helpers when native is disabled', () => {
  process.env.POSTCSS_GO_DISABLE_NATIVE = '1';
  try {
    installNativeSyncCssRuntime();
    expect(() => parseCssSync('.a{}')).toThrow(SyncBackendUnavailableError);
  } finally {
    if (originalDisableNative === undefined) delete process.env.POSTCSS_GO_DISABLE_NATIVE;
    else process.env.POSTCSS_GO_DISABLE_NATIVE = originalDisableNative;
    installNativeSyncCssRuntime();
  }
});

test.runIf(isNativeAsyncBridgeAvailable())(
  'parseCssSync and Node#toString use the Go N-API stringifier',
  () => {
    installNativeSyncCssRuntime();
    const root = parseCssSync({ toString: () => '.a { color: red }' });
    expect(root.toString()).toContain('color: red');

    const rule = root.first as Rule;
    const chunks: Array<{ css: string; node?: unknown; type?: string }> = [];
    stringifyCssSync(root, (css, node, type) => {
      chunks.push({ css, node, type });
    });
    expect(chunks.map((part) => part.css).join('')).toContain('color: red');
    expect(chunks.some((part) => part.type === 'start' && part.node === rule)).toBe(true);

    const nested = parseCssSync('@page{}a{}');
    const page = new AtRule({ name: 'page', params: '1', nodes: [] });
    nested.append(page);
    expect(page.toString()).toBe('@page 1{}');
    expect(rule.toString()).toContain('color: red');
  },
);
