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
        expect(root.type).toBe('root');
        return 'maps/c.css.map';
      },
    },
  });
  expect(worker.sent.at(-1)).toEqual({
    id: 4,
    method: 'parse',
    params: { css: '.c {}', options: { from: '/src/c.css' } },
  });
  worker.respond({ id: 4, result: { root: { type: 'root', nodes: [] } } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(worker.sent.at(-1)).toEqual({
    id: 5,
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
  worker.respond({ id: 5, result: { css: '.c {}', map: '{}' } });
  await annotated;
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
