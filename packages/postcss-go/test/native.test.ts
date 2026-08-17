import { afterEach, expect, test, vi } from 'vitest';

import {
  createDefaultAsyncService,
  createNativeService,
  getDefaultAsyncBackendCapabilities,
  isNativeAsyncBridgeAvailable,
  NativePostcssGoService,
} from '../src/native.ts';
import { encodeAst } from '../src/codec.ts';
import { AsyncBackendUnavailableError, AsyncPluginError } from '../src/errors.ts';

const originalDisableNative = process.env.POSTCSS_GO_DISABLE_NATIVE;

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
    process() {
      throw nativeError;
    },
  } as never);

  expect(() => service.processSync('.invalid {')).toThrow(nativeError);
});

test.each([
  ['missing process frame header', Buffer.from('invalid')],
  [
    'metadata length beyond process frame',
    Buffer.from([0x50, 0x43, 0x47, 0x50, 0xff, 0xff, 0xff, 0x7f]),
  ],
])('rejects %s', (_name, frame) => {
  const service = new NativePostcssGoService({
    process() {
      return frame;
    },
  } as never);

  expect(() => service.processSync('.a{}')).toThrow(/native process response/);
});

test('createNativeService fails when the addon is disabled', () => {
  process.env.POSTCSS_GO_DISABLE_NATIVE = '1';
  expect(() => createNativeService()).toThrow(/native addon is unavailable/);
});

test('syntax-prefixed native errors rebuild structured CssSyntaxError metadata from Go JSON', () => {
  const payload = JSON.stringify({
    name: 'CssSyntaxError',
    reason: 'Unknown word: expected declaration',
    line: 2,
    column: 3,
    file: 'contract/input.css',
  });
  const service = new NativePostcssGoService({
    parse() {
      throw new Error(`postcss-go:css-syntax:${payload}`);
    },
    parseAsync() {
      return Promise.reject(new Error(`postcss-go:css-syntax:${payload}`));
    },
  } as never);

  // `a {` would be "Unclosed block" if native still re-ran the JavaScript parser.
  expect(() => service.parseSync('a {')).toThrow(
    expect.objectContaining({
      name: 'CssSyntaxError',
      reason: 'Unknown word: expected declaration',
      line: 2,
      column: 3,
      file: 'contract/input.css',
      source: 'a {',
    }),
  );
});

test('syntax-prefixed native errors keep Go metadata when the JSON payload is malformed', () => {
  const service = new NativePostcssGoService({
    parse() {
      throw new Error('postcss-go:css-syntax: Unexpected }');
    },
  } as never);

  expect(() => service.parseSync('a {')).toThrow(
    expect.objectContaining({
      name: 'CssSyntaxError',
      reason: 'Unexpected }',
      source: 'a {',
    }),
  );
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

test('async stringify annotation callbacks are awaited', async () => {
  const service = new NativePostcssGoService({
    async stringifyAsync() {
      return JSON.stringify({ css: '.a{}' });
    },
  } as never);

  const result = await service.stringifyResult(
    { type: 'root', nodes: [] },
    {
      to: 'out.css',
      map: {
        annotation: async () => 'generated.css.map',
      },
    },
  );
  expect(result.css).toBe('.a{}');
});

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

test('processSync with annotation callbacks stringifies through the live path', () => {
  const rootBuf = encodeAst({ type: 'root', nodes: [] });
  const service = new NativePostcssGoService({
    parse() {
      return rootBuf;
    },
    stringify() {
      return JSON.stringify({ css: '.annotated{}' });
    },
  } as never);

  const result = service.processSync('.a{}', {
    to: 'out.css',
    map: {
      annotation: () => 'out.css.map',
    },
  });
  expect(result.css).toBe('.annotated{}');
  expect(result.backend).toBe('native');
});

test('process with annotation callbacks stringifies through the live async path', async () => {
  const rootBuf = encodeAst({ type: 'root', nodes: [] });
  const service = new NativePostcssGoService({
    async parseAsync() {
      return rootBuf;
    },
    async stringifyAsync() {
      return JSON.stringify({ css: '.annotated{}' });
    },
  } as never);

  const result = await service.process('.a{}', {
    to: 'out.css',
    map: {
      annotation: async () => 'out.css.map',
    },
  });
  expect(result.css).toBe('.annotated{}');
  expect(result.backend).toBe('native');
});
