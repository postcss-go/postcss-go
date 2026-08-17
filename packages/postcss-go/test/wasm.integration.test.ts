import { expect, test } from 'vitest';

import {
  BrowserPostcssGoService,
  CssSyntaxError,
  createBrowserProcessor,
  SyncBackendUnavailableError,
  WasmWorkerError,
} from '../src/wasm/index.ts';
import { RealWasmWorker, loadRealWasmRuntime, wasmAssetUrls } from './helpers/real-wasm-worker.ts';

test('real WASM runtime parses, processes, stringifies, and shuts down', async () => {
  await loadRealWasmRuntime();
  const worker = new RealWasmWorker();
  const service = new BrowserPostcssGoService({
    ...wasmAssetUrls(),
    worker,
  });

  const parsed = await service.parse('.a { color: red }', { from: 'a.css' });
  expect(parsed.root).toMatchObject({ type: 'root' });

  const processed = await service.process('.a { color: red }', {
    from: 'a.css',
    map: { inline: false, annotation: false },
  });
  expect(processed.css).toContain('color');
  expect(processed.backend).toBe('wasm-worker');
  expect(typeof processed.map === 'string' || processed.map == null).toBe(true);
  expect(processed.mapFile).toBe('a.css.map');

  const noWork = await service.noWork('.a { color: red }', { map: false });
  expect(noWork.css).toBe('.a { color: red }');

  const stringified = await service.stringifyResult(parsed.root, {
    from: 'a.css',
    map: { inline: false, annotation: false },
  });
  expect(stringified.css).toContain('.a');

  await service.close();
  await expect(service.parse('.b {}')).rejects.toBeInstanceOf(WasmWorkerError);
});

test('real WASM runtime emits usable source maps', async () => {
  const service = new BrowserPostcssGoService({ worker: new RealWasmWorker() });
  const result = await service.process('.a { color: red }\n', {
    from: 'mapped.css',
    to: 'mapped.out.css',
    map: { inline: false, annotation: false },
  });
  expect(typeof result.map).toBe('string');
  expect(result.mapFile).toBe('mapped.out.css.map');
  const map = JSON.parse(String(result.map)) as {
    version: number;
    sources?: string[];
    mappings?: string;
  };
  expect(map.version).toBe(3);
  expect(map.mappings?.length).toBeGreaterThan(0);
  expect(map.sources?.some((source) => source.includes('mapped'))).toBe(true);
  await service.close();
});

test('annotation callbacks preserve previous source-map origins', async () => {
  const service = new BrowserPostcssGoService({ worker: new RealWasmWorker() });
  const previousMap = JSON.stringify({
    version: 3,
    file: 'generated.css',
    sources: ['original.scss'],
    sourcesContent: ['.a { color: red }'],
    names: [],
    mappings: 'AAAA',
  });
  const result = await service.process('.a { color: red }', {
    from: 'generated.css',
    to: 'output.css',
    map: {
      prev: previousMap,
      inline: false,
      annotation: () => 'maps/output.css.map',
    },
  });
  const map = JSON.parse(String(result.map)) as { sources?: string[] };
  expect(map.sources?.some((source) => source.endsWith('original.scss'))).toBe(true);
  expect(result.mapFile).toBe('maps/output.css.map');
  await service.close();
});

test('real WASM runtime surfaces structured CssSyntaxError metadata', async () => {
  const service = new BrowserPostcssGoService({ worker: new RealWasmWorker() });
  const rejected = service.process('{', { from: 'broken.css' });
  await expect(rejected).rejects.toBeInstanceOf(CssSyntaxError);
  await expect(rejected).rejects.toMatchObject({
    name: 'CssSyntaxError',
    line: expect.any(Number),
    column: expect.any(Number),
  });
  await service.close();
});

test('browser processor runs asynchronous plugins over real WASM', async () => {
  const processor = createBrowserProcessor(
    [
      {
        postcssPlugin: 'async-to-blue',
        async Once(root) {
          await Promise.resolve();
          root.walkDecls('color', (decl) => {
            decl.value = 'blue';
          });
        },
      },
    ],
    { worker: new RealWasmWorker() },
  );

  const result = await processor.process('.button { color: red }', { from: 'button.css' });
  expect(result.css).toContain('blue');
  expect(result.backend).toBe('wasm-worker');
  await processor.close();
});

test('browser WASM plugins reject synchronous CSS parse and string insertion', async () => {
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
    { worker: new RealWasmWorker() },
  );

  const result = await processor.process('.a { color: red }', { from: 'a.css', map: false });
  expect(result.css).toContain('red');
  await processor.close();
});

test('browser WASM service rejects synchronous APIs with SyncBackendUnavailableError', () => {
  const service = new BrowserPostcssGoService({ worker: new RealWasmWorker() });
  expect(() => service.parseSync('.a {}')).toThrow(SyncBackendUnavailableError);
  expect(() => service.processSync('.a {}')).toThrow(SyncBackendUnavailableError);
  expect(() => service.noWorkSync('.a {}')).toThrow(SyncBackendUnavailableError);
  expect(() => service.stringifySync({ type: 'root', nodes: [] })).toThrow(
    SyncBackendUnavailableError,
  );
  expect(() => service.stringifyResultSync({ type: 'root', nodes: [] })).toThrow(
    SyncBackendUnavailableError,
  );
});
