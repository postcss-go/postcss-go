import { expect, test } from 'vitest';

import {
  BrowserPostcssGoService,
  UnsupportedServiceError,
} from '../src/index.ts';

test('wasm package re-exports the browser service surface', async () => {
  const service = new BrowserPostcssGoService({
    workerUrl: '/worker.js',
    wasmUrl: '/runtime.wasm',
  });

  expect(service.workerUrl).toBe('/worker.js');
  expect(service.wasmUrl).toBe('/runtime.wasm');

  await expect(service.parse('.a {}')).rejects.toThrow(UnsupportedServiceError);
  await expect(service.process('.a {}')).rejects.toThrow(UnsupportedServiceError);
  await expect(service.stringify({ type: 'root', nodes: [] })).rejects.toThrow(
    UnsupportedServiceError,
  );
});
