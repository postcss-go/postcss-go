import { afterEach, expect, test, vi } from 'vitest';

import {
  createDefaultAsyncService,
  getDefaultAsyncBackendCapabilities,
  isNativeAsyncBridgeAvailable,
  NativePostcssGoService,
} from '../src/native.ts';
import { AsyncBackendUnavailableError } from '../src/errors.ts';

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
