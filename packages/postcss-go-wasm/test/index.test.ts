import { expect, test } from 'vitest';

import { BrowserPostcssGoService } from '../src/index.ts';

class FakeWorker {
  readonly sent: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;

  postMessage(message: unknown) {
    this.sent.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  respond(message: unknown) {
    this.onmessage?.({ data: message } as MessageEvent);
  }

  fail(error: Error) {
    this.onerror?.({ error, message: error.message } as ErrorEvent);
  }
}

test('wasm package re-exports the browser service surface', () => {
  const service = new BrowserPostcssGoService({
    workerUrl: '/worker.js',
    wasmUrl: '/runtime.wasm',
    worker: new FakeWorker(),
  });

  expect(service.workerUrl).toBe('/worker.js');
  expect(service.wasmUrl).toBe('/runtime.wasm');
});

test('browser service dispatches parse requests and resolves matching responses', async () => {
  const worker = new FakeWorker();
  const service = new BrowserPostcssGoService({ worker });

  const pending = service.parse('.a {}');
  expect(worker.sent).toEqual([{ id: 1, method: 'parse', params: { css: '.a {}', options: {} } }]);

  worker.respond({ id: 1, result: { root: { type: 'root', nodes: [] } } });
  await expect(pending).resolves.toEqual({ root: { type: 'root', nodes: [] } });
  await service.close();
});

test('browser service rejects RPC errors and pending calls on close', async () => {
  const worker = new FakeWorker();
  const service = new BrowserPostcssGoService({ worker });
  const rejected = service.process('.a {}');

  worker.respond({ id: 1, error: { message: 'bad css', name: 'CssSyntaxError' } });
  await expect(rejected).rejects.toMatchObject({ name: 'CssSyntaxError', message: 'bad css' });

  const pending = service.stringify({ type: 'root', nodes: [] });
  await service.close();
  expect(worker.terminated).toBe(true);
  await expect(pending).rejects.toThrow(/closed/);
});
