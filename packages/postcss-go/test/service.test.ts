import { expect, test } from 'vitest';

import {
  NATIVE_BACKEND_CAPABILITIES,
  WASM_WORKER_BACKEND_CAPABILITIES,
  UnsupportedServiceError,
  isSyncPostcssGoService,
  type PostcssGoService,
} from '../src/service.ts';

test('UnsupportedServiceError sets a stable error name', () => {
  const error = new UnsupportedServiceError('browser runtime is unavailable');

  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe('UnsupportedServiceError');
  expect(error.message).toBe('browser runtime is unavailable');
});

test('isSyncPostcssGoService validates capability and the complete sync surface', () => {
  const methods = {
    parseSync() {},
    processSync() {},
    noWorkSync() {},
    stringifySync() {},
    stringifyResultSync() {},
  };

  expect(
    isSyncPostcssGoService({
      capabilities: WASM_WORKER_BACKEND_CAPABILITIES,
      ...methods,
    } as unknown as PostcssGoService),
  ).toBe(false);
  expect(
    isSyncPostcssGoService({
      capabilities: NATIVE_BACKEND_CAPABILITIES,
      ...methods,
    } as unknown as PostcssGoService),
  ).toBe(true);
  expect(
    isSyncPostcssGoService({
      capabilities: NATIVE_BACKEND_CAPABILITIES,
      ...methods,
      stringifyResultSync: undefined,
    } as unknown as PostcssGoService),
  ).toBe(false);
});
