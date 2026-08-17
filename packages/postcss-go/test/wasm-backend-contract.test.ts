import { afterAll, expect, test } from 'vitest';

import { createNativeService, isNativeBridgeAvailable } from '../src/native.ts';
import { Processor } from '../src/processor.ts';
import { createBrowserProcessor, type BrowserPostcssGoService } from '../src/wasm/browser.ts';
import type { PostcssGoService } from '../src/service.ts';
import { RealWasmWorker } from './helpers/real-wasm-worker.ts';

type OwnedService = {
  name: string;
  service: PostcssGoService;
  close: () => Promise<void>;
};

function createWasmService(): OwnedService {
  const worker = new RealWasmWorker();
  const service = createBrowserProcessor([], { worker }).service as BrowserPostcssGoService;
  return {
    name: 'browser-wasm-worker',
    service,
    close: () => service.close(),
  };
}

function createNativeOwnedService(): OwnedService {
  const service = createNativeService();
  return {
    name: 'native-node',
    service,
    close: () => service.close(),
  };
}

const owned: OwnedService[] = [createWasmService()];
if (isNativeBridgeAvailable()) owned.unshift(createNativeOwnedService());

afterAll(async () => {
  for (const entry of owned) await entry.close();
});

for (const entry of owned) {
  test(`${entry.name}: shared parse / process / stringify / noWork contract`, async () => {
    const { service, name } = entry;
    const css = '.card { color: tomato; }';

    const parsed = await service.parse(css, { from: `${name}.css` });
    expect(parsed.root).toMatchObject({ type: 'root' });

    const processed = await service.process(css, {
      from: `${name}.css`,
      map: { inline: false, annotation: false },
    });
    expect(processed.css).toContain('tomato');
    expect(processed.root).toMatchObject({ type: 'root' });

    const stringified = await service.stringifyResult(parsed.root, {
      from: `${name}.css`,
      map: false,
    });
    expect(stringified.css).toContain('.card');

    const noWork = await service.noWork(css, { map: false });
    expect(noWork.css).toBe(css);
  });

  test(`${entry.name}: shared source-map contract`, async () => {
    const { service, name } = entry;
    const css = '.hero { color: crimson; }\n';

    const withMap = await service.process(css, {
      from: `${name}-map.css`,
      to: `${name}-map.out.css`,
      map: { inline: false, annotation: false },
    });
    expect(withMap.css).toContain('crimson');
    expect(typeof withMap.map).toBe('string');
    const map = JSON.parse(String(withMap.map)) as {
      version: number;
      sources?: string[];
      mappings?: string;
    };
    expect(map.version).toBe(3);
    expect(map.mappings).toEqual(expect.any(String));
    expect(map.mappings!.length).toBeGreaterThan(0);
    expect(map.sources?.some((source) => source.includes(`${name}-map`))).toBe(true);

    const stringified = await service.stringifyResult(
      (await service.parse(css, { from: `${name}-map.css` })).root,
      {
        from: `${name}-map.css`,
        to: `${name}-map.out.css`,
        map: { inline: false, annotation: false },
      },
    );
    expect(typeof stringified.map).toBe('string');
    expect(JSON.parse(String(stringified.map)).version).toBe(3);
  });

  test(`${entry.name}: shared syntax-error contract`, async () => {
    const { service, name } = entry;
    await expect(service.process('{', { from: `${name}-broken.css` })).rejects.toMatchObject({
      name: 'CssSyntaxError',
      line: expect.any(Number),
      column: expect.any(Number),
    });
  });
}

test('native Node and browser WASM Worker share the async plugin contract', async () => {
  const plugin = {
    postcssPlugin: 'shared-async',
    async Declaration(decl: { prop: string; value: string }) {
      await Promise.resolve();
      if (decl.prop === 'color') decl.value = 'navy';
    },
  };

  const wasm = createBrowserProcessor([plugin], { worker: new RealWasmWorker() });
  const wasmResult = await wasm.process('.x { color: red }', { from: 'wasm.css' });
  expect(wasmResult.css).toContain('navy');
  expect(wasmResult.backend).toBe('wasm-worker');
  await wasm.close();

  if (!isNativeBridgeAvailable()) return;

  const native = createNativeService();
  try {
    const nativeResult = await new Processor([plugin]).process(
      '.x { color: red }',
      { from: 'native.css' },
      { service: native },
    );
    expect(nativeResult.css).toContain('navy');
    expect(nativeResult.backend).toBe('native');
  } finally {
    await native.close();
  }
});

test('native Node and browser WASM Worker share visitor mutation + OnceExit ordering', async () => {
  function createOrderingPlugin(events: string[]) {
    return {
      postcssPlugin: 'order-and-mutate',
      Once() {
        events.push('once');
      },
      Declaration(decl: { prop: string; value: string }) {
        if (decl.prop === 'color') decl.value = 'teal';
        events.push(`decl:${decl.prop}`);
      },
      OnceExit() {
        events.push('once-exit');
      },
    };
  }

  const wasmEvents: string[] = [];
  const wasmProc = createBrowserProcessor([createOrderingPlugin(wasmEvents)], {
    worker: new RealWasmWorker(),
  });
  const wasmResult = await wasmProc.process('.box { color: red; display: block }', {
    from: 'wasm-order.css',
  });
  expect(wasmResult.css).toContain('teal');
  expect(wasmEvents[0]).toBe('once');
  expect(wasmEvents.at(-1)).toBe('once-exit');
  expect(wasmEvents).toContain('decl:color');
  expect(wasmEvents).toContain('decl:display');
  await wasmProc.close();

  if (!isNativeBridgeAvailable()) return;

  const nativeEvents: string[] = [];
  const native = createNativeService();
  try {
    const nativeResult = await new Processor([createOrderingPlugin(nativeEvents)]).process(
      '.box { color: red; display: block }',
      { from: 'native-order.css' },
      { service: native },
    );
    expect(nativeResult.css).toContain('teal');
    expect(nativeEvents).toEqual(wasmEvents);
  } finally {
    await native.close();
  }
});
