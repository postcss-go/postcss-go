import { expect, test, vi } from 'vitest';

import {
  BrowserPostcssGoService,
  createBrowserProcessor,
  rejectBrowserSyncApi,
} from '../src/wasm/browser.ts';
import { SyncBackendUnavailableError } from '../src/errors.ts';
import { WasmWorkerError } from '../src/wasm/errors.ts';

class FakeBrowserWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { error?: unknown; message?: string }) => void) | null = null;
  readonly sent: unknown[] = [];
  terminated = false;

  postMessage(message: unknown) {
    this.sent.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  respond(message: unknown) {
    this.onmessage?.({ data: message });
  }
}

test('BrowserPostcssGoService accepts a worker transport', async () => {
  const service = new BrowserPostcssGoService({
    workerUrl: '/worker.js',
    wasmUrl: '/postcss-go.wasm',
    worker: new FakeBrowserWorker(),
  });

  expect(service.workerUrl).toBe('/worker.js');
  expect(service.wasmUrl).toBe('/postcss-go.wasm');
  expect(service.capabilities.synchronous).toBe(false);

  await expect(service.close()).resolves.toBeUndefined();
});

test('createBrowserProcessor runs plugins through the injected worker service', async () => {
  const worker = new FakeBrowserWorker();
  const processor = createBrowserProcessor(
    [
      {
        postcssPlugin: 'to-blue',
        Declaration(decl) {
          if (decl.prop === 'color') decl.value = 'blue';
        },
      },
    ],
    { worker },
  );

  const pending = processor.process('.a { color: red }', { from: 'a.css', map: false });
  await vi.waitFor(() => expect(worker.sent[0]).toMatchObject({ method: 'parse' }));
  worker.respond({
    id: 1,
    result: {
      root: {
        type: 'root',
        nodes: [
          {
            type: 'rule',
            selector: '.a',
            nodes: [{ type: 'decl', prop: 'color', value: 'red' }],
          },
        ],
      },
    },
  });
  await vi.waitFor(() => expect(worker.sent.at(-1)).toMatchObject({ method: 'stringify' }));
  worker.respond({ id: 2, result: { css: '.a { color: blue }' } });

  const result = await pending;
  expect(result.css).toContain('blue');
  expect(result.backend).toBe('wasm-worker');
  await processor.close();
  expect(worker.terminated).toBe(true);
});

test('browser plugins reject synchronous CSS parse and string insertion', async () => {
  const worker = new FakeBrowserWorker();
  const processor = createBrowserProcessor(
    [
      {
        postcssPlugin: 'needs-sync-parse',
        Once(root, helpers) {
          expect(() => helpers.postcss.parse('.b{}')).toThrow(SyncBackendUnavailableError);
          expect(() => root.append('.b{}')).toThrow(SyncBackendUnavailableError);
          expect(() => root.toString()).toThrow(SyncBackendUnavailableError);
          expect(() => helpers.postcss.stringify(root)).toThrow(SyncBackendUnavailableError);
        },
      },
    ],
    { worker },
  );

  const pending = processor.process('.a { color: red }', { from: 'a.css', map: false });
  await vi.waitFor(() => expect(worker.sent[0]).toMatchObject({ method: 'parse' }));
  worker.respond({
    id: 1,
    result: {
      root: {
        type: 'root',
        nodes: [
          {
            type: 'rule',
            selector: '.a',
            nodes: [{ type: 'decl', prop: 'color', value: 'red' }],
          },
        ],
      },
    },
  });
  await vi.waitFor(() => expect(worker.sent.at(-1)).toMatchObject({ method: 'stringify' }));
  worker.respond({ id: 2, result: { css: '.a { color: red }' } });

  const result = await pending;
  expect(result.css).toContain('red');
  await processor.close();
});

test('browser service rejects sync APIs and missing Worker transport', () => {
  const service = new BrowserPostcssGoService({ worker: new FakeBrowserWorker() });
  expect(() => service.parseSync('.a{}')).toThrow(SyncBackendUnavailableError);
  expect(() => rejectBrowserSyncApi('processSync')).toThrow(SyncBackendUnavailableError);

  const WorkerRef = globalThis.Worker;
  // @ts-expect-error intentional for the missing-Worker branch
  delete globalThis.Worker;
  try {
    expect(() => new BrowserPostcssGoService({ workerUrl: '/worker.js' })).toThrow(WasmWorkerError);
  } finally {
    globalThis.Worker = WorkerRef;
  }
});

test('browser service rebuilds CssSyntaxError from Worker RPC payloads', async () => {
  const { CssSyntaxError } = await import('../src/errors.ts');
  const worker = new FakeBrowserWorker();
  const service = new BrowserPostcssGoService({ worker });
  const pending = service.process('{', { from: 'broken.css' });

  worker.respond({
    id: 1,
    error: {
      name: 'CssSyntaxError',
      message: 'CssSyntaxError: broken.css:1:1: Unexpected }',
      reason: 'Unexpected }',
      line: 1,
      column: 1,
      file: 'broken.css',
      source: '{',
    },
  });

  await expect(pending).rejects.toBeInstanceOf(CssSyntaxError);
  await expect(pending).rejects.toMatchObject({
    name: 'CssSyntaxError',
    reason: 'Unexpected }',
    line: 1,
    column: 1,
    file: 'broken.css',
  });
  await service.close();
});

test('browser service sends init when asset URLs accompany an injected worker', () => {
  const worker = new FakeBrowserWorker();
  const service = new BrowserPostcssGoService({
    worker,
    wasmUrl: '/postcss-go.wasm',
    wasmExecUrl: '/wasm_exec.js',
  });
  expect(worker.sent[0]).toEqual({
    type: 'init',
    wasmUrl: '/postcss-go.wasm',
    wasmExecUrl: '/wasm_exec.js',
  });
  return service.close();
});

test('browser service rejects pending calls on request timeout', async () => {
  const worker = new FakeBrowserWorker();
  const service = new BrowserPostcssGoService({ worker, requestTimeoutMs: 20 });
  await expect(service.parse('.a {}')).rejects.toMatchObject({
    name: 'WasmWorkerError',
    message: expect.stringMatching(/timed out/),
  });
  await service.close();
});

test('browser process annotation callbacks receive live roots with Input metadata', async () => {
  const worker = new FakeBrowserWorker();
  const service = new BrowserPostcssGoService({ worker });
  let seenInput: unknown;
  const previousMap = JSON.stringify({
    version: 3,
    file: 'a.css',
    sources: ['original.scss'],
    sourcesContent: ['.a { color: red }'],
    names: [],
    mappings: 'AAAA',
  });
  const pending = service.process('.a { color: red }', {
    from: '/src/a.css',
    to: '/dist/a.css',
    map: {
      inline: false,
      prev: previousMap,
      annotation(file, root) {
        expect(file).toBe('/dist/a.css');
        expect(root.type).toBe('root');
        seenInput = root.source?.input;
        expect(root.source?.input).toBeTruthy();
        expect(String(root.source?.input?.from ?? '')).toContain('a.css');
        return 'maps/a.css.map';
      },
    },
  });

  await vi.waitFor(() => expect(worker.sent.at(-1)).toMatchObject({ method: 'parse' }));
  expect(worker.sent.at(-1)).toMatchObject({
    params: {
      options: {
        previousMap,
        previousMapUrl: '/src/a.css.map',
      },
    },
  });
  worker.respond({
    id: 1,
    result: {
      root: {
        type: 'root',
        nodes: [
          { type: 'rule', selector: '.a', nodes: [{ type: 'decl', prop: 'color', value: 'red' }] },
        ],
      },
    },
  });
  await vi.waitFor(() => expect(worker.sent.at(-1)).toMatchObject({ method: 'stringify' }));
  expect(worker.sent.at(-1)).toMatchObject({
    params: {
      ast: {
        source: {
          map: previousMap,
        },
      },
    },
  });
  worker.respond({ id: 2, result: { css: '.a { color: red }', map: '{"version":3}' } });

  const result = await pending;
  expect(seenInput).toBeTruthy();
  expect(result.backend).toBe('wasm-worker');
  await service.close();
});

test('browser service rejects all pending calls on Worker runtime-error', async () => {
  const worker = new FakeBrowserWorker();
  const service = new BrowserPostcssGoService({ worker });
  const pending = service.parse('.a {}');
  worker.respond({
    type: 'runtime-error',
    error: { message: 'Go runtime crashed', name: 'WasmWorkerError' },
  });
  await expect(pending).rejects.toMatchObject({
    name: 'WasmWorkerError',
    message: 'Go runtime crashed',
  });
  expect(worker.terminated).toBe(true);
  await expect(service.parse('.b {}')).rejects.toBeInstanceOf(WasmWorkerError);
  await service.close();
});
