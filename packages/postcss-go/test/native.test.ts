import { afterEach, expect, test } from 'vitest';

import {
  createDefaultAsyncService,
  getDefaultAsyncBackendCapabilities,
  isNativeAsyncBridgeAvailable,
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
