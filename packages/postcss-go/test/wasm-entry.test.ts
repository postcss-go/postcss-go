import { expect, test } from 'vitest';

import { BrowserPostcssGoService, CssSyntaxError } from '../src/wasm/index.ts';

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

test('postcss-go/wasm exports createBrowserProcessor and stable error types', async () => {
  const api = await import('../src/wasm/index.ts');
  expect(api).toHaveProperty('createBrowserProcessor');
  expect(api).toHaveProperty('WasmWorkerError');
  expect(api).toHaveProperty('SyncBackendUnavailableError');
  expect(api).toHaveProperty('errorFromWasmDto');
});

test('browser service dispatches parse requests and resolves matching responses', async () => {
  const worker = new FakeWorker();
  const service = new BrowserPostcssGoService({ worker });

  const pending = service.parse('.a {}');
  expect(worker.sent).toEqual([{ id: 1, method: 'parse', params: { css: '.a {}', options: {} } }]);

  worker.respond({ id: 1, result: { root: { type: 'root', nodes: [] } } });
  await expect(pending).resolves.toEqual({ root: { type: 'root', nodes: [] } });

  const noWork = service.noWork('.a {}', { map: false });
  expect(worker.sent.at(-1)).toEqual({
    id: 2,
    method: 'noWork',
    params: { css: '.a {}', options: { map: false } },
  });
  worker.respond({ id: 2, result: { css: '.a {}' } });
  await expect(noWork).resolves.toEqual({ css: '.a {}' });

  const inline = service.noWork('.b {}', { map: { inline: true } });
  expect(worker.sent.at(-1)).toEqual({
    id: 3,
    method: 'noWork',
    params: {
      css: '.b {}',
      options: {
        map: true,
        mapInline: true,
        mapAnnotationDisabled: true,
      },
    },
  });
  worker.respond({ id: 3, result: { css: '.b {}' } });
  await inline;

  const annotated = service.noWork('.c {}', {
    from: '/src/c.css',
    to: '/dist/c.css',
    map: {
      inline: false,
      annotation(file, root) {
        expect(file).toBe('/dist/c.css');
        expect(root).toBeUndefined();
        return 'maps/c.css.map';
      },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(worker.sent.at(-1)).toEqual({
    id: 4,
    method: 'noWork',
    params: {
      css: '.c {}',
      options: {
        from: '/src/c.css',
        to: '/dist/c.css',
        map: true,
        mapFile: '/dist/maps/c.css.map',
        mapInline: false,
        mapAnnotation: 'maps/c.css.map',
        mapAnnotationDisabled: false,
      },
    },
  });
  worker.respond({ id: 4, result: { css: '.c {}', map: '{}' } });
  await annotated;

  const processAnnotated = service.process('.d { color: red }', {
    from: '/src/d.css',
    to: '/dist/d.css',
    map: {
      inline: false,
      annotation(file, root) {
        expect(file).toBe('/dist/d.css');
        expect(root).toMatchObject({ type: 'root' });
        expect(root?.source?.input).toBeTruthy();
        expect(root?.source?.input?.file ?? root?.source?.input?.from).toBe('/src/d.css');
        return 'maps/d.css.map';
      },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(worker.sent.at(-1)).toMatchObject({
    id: 5,
    method: 'parse',
    params: { css: '.d { color: red }', options: { from: '/src/d.css' } },
  });
  worker.respond({
    id: 5,
    result: {
      root: {
        type: 'root',
        nodes: [
          { type: 'rule', selector: '.d', nodes: [{ type: 'decl', prop: 'color', value: 'red' }] },
        ],
      },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(worker.sent.at(-1)).toMatchObject({
    id: 6,
    method: 'stringify',
  });
  expect(
    worker.sent.filter((message) => (message as { method?: string }).method === 'process'),
  ).toHaveLength(0);
  worker.respond({ id: 6, result: { css: '.d { color: red }', map: '{"version":3}' } });
  const processedAnnotated = await processAnnotated;
  expect(processedAnnotated.backend).toBe('wasm-worker');
  expect(processedAnnotated.root).toMatchObject({ type: 'root' });

  await service.close();
});

test('browser service sends init when wasm asset URLs are provided', () => {
  const worker = new FakeWorker();
  const service = new BrowserPostcssGoService({
    workerUrl: '/worker.js',
    wasmUrl: '/runtime.wasm',
    wasmExecUrl: '/wasm_exec.js',
    worker,
  });

  expect(worker.sent).toEqual([
    { type: 'init', wasmUrl: '/runtime.wasm', wasmExecUrl: '/wasm_exec.js' },
  ]);
  expect(service.workerUrl).toBe('/worker.js');
  expect(service.wasmUrl).toBe('/runtime.wasm');
  return service.close();
});

test('browser service rejects RPC errors and pending calls on close', async () => {
  const worker = new FakeWorker();
  const service = new BrowserPostcssGoService({ worker });
  const rejected = service.process('.a {}');

  worker.respond({
    id: 1,
    error: {
      message: 'CssSyntaxError: <css input>:1:1: bad css',
      name: 'CssSyntaxError',
      reason: 'bad css',
      line: 1,
      column: 1,
    },
  });
  await expect(rejected).rejects.toBeInstanceOf(CssSyntaxError);
  await expect(rejected).rejects.toMatchObject({
    name: 'CssSyntaxError',
    reason: 'bad css',
    line: 1,
    column: 1,
  });

  const pending = service.stringify({ type: 'root', nodes: [] });
  await service.close();
  expect(worker.terminated).toBe(true);
  expect(worker.sent.at(-1)).toEqual({ type: 'shutdown' });
  await expect(pending).rejects.toMatchObject({
    name: 'WasmWorkerError',
    message: expect.stringMatching(/closed/),
  });
});
