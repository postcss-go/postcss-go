import { expect, test } from 'vitest';

import { BrowserPostcssGoService } from '../src/index.ts';

class FakeBrowserWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { error?: unknown; message?: string }) => void) | null = null;

  postMessage() {}

  terminate() {}
}

test('BrowserPostcssGoService accepts a worker transport', async () => {
  const service = new BrowserPostcssGoService({
    workerUrl: '/worker.js',
    wasmUrl: '/postcss-go.wasm',
    worker: new FakeBrowserWorker(),
  });

  expect(service.workerUrl).toBe('/worker.js');
  expect(service.wasmUrl).toBe('/postcss-go.wasm');

  await expect(service.close()).resolves.toBeUndefined();
});
