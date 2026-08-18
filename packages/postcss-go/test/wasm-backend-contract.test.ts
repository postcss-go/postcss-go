import { afterAll, expect, test } from 'vitest';

import { createNativeService } from '../src/native.ts';
import { Processor } from '../src/processor.ts';
import { createBrowserProcessor, type BrowserPostcssGoService } from '../src/wasm/browser.ts';
import type { PostcssGoService } from '../src/service.ts';
import {
  coreCssContract,
  coreCssMapOptions,
  coreCssPreviousMapOptions,
  expectCoreCssPreviousMap,
  expectCoreCssSourceMap,
  expectUnchangedCoreCss,
  normalizeContractAst,
  stripSourceMapAnnotation,
} from './helpers/core-css-contract.ts';
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

const owned: OwnedService[] = [createNativeOwnedService(), createWasmService()];

afterAll(async () => {
  for (const entry of owned) await entry.close();
});

for (const entry of owned) {
  test(`${entry.name}: shared parse / process / stringify / noWork contract`, async () => {
    const { service } = entry;
    const css = coreCssContract.css;

    for (const scenario of coreCssContract.roundTrips) {
      const parsed = await service.parse(scenario.css, { from: coreCssContract.from });
      expect(normalizeContractAst(parsed.root), scenario.name).toEqual(scenario.ast);
      const stringified = await service.stringifyResult(parsed.root, {
        from: coreCssContract.from,
        map: false,
      });
      expect(stringified.css, scenario.name).toBe(scenario.css);
    }

    const processed = await service.process(css, {
      from: coreCssContract.from,
      map: coreCssMapOptions,
    });
    expectUnchangedCoreCss(processed.css);
    expect(processed.root).toMatchObject({ type: 'root' });

    const noWork = await service.noWork(css, { map: false });
    expect(noWork.css).toBe(css);
    const staleAnnotation = `${css}/*# sourceMappingURL=stale.css.map */\n`;
    expect(
      stripSourceMapAnnotation((await service.noWork(staleAnnotation, { map: false })).css),
    ).toBe(coreCssContract.noWorkCleanCss);

    const roots = await Promise.all([
      service.parse('a { color: red; }\n', { from: 'contract/a.css' }),
      service.parse('b { color: blue; }\n', { from: 'contract/b.css' }),
    ]);
    const document = {
      type: 'document',
      raws: {},
      nodes: roots.map((result) => result.root),
    } as never;
    expect((await service.stringifyResult(document, { map: false })).css).toBe(
      coreCssContract.documentCss,
    );
  });

  test(`${entry.name}: shared source-map contract`, async () => {
    const { service } = entry;
    const css = coreCssContract.css;

    const withMap = await service.process(css, {
      from: coreCssContract.from,
      to: coreCssContract.to,
      map: coreCssMapOptions,
    });
    expectUnchangedCoreCss(withMap.css);
    expectCoreCssSourceMap(withMap.map);

    const withPrev = await service.process(css, {
      from: coreCssContract.from,
      to: coreCssContract.to,
      map: coreCssPreviousMapOptions,
    });
    expectUnchangedCoreCss(withPrev.css);
    expectCoreCssPreviousMap(withPrev.map);

    const stringified = await service.stringifyResult(
      (await service.parse(css, { from: coreCssContract.from })).root,
      {
        from: coreCssContract.from,
        to: coreCssContract.to,
        map: coreCssMapOptions,
      },
    );
    expectCoreCssSourceMap(stringified.map);

    const inline = await service.process(css, {
      from: coreCssContract.from,
      to: coreCssContract.to,
      map: { inline: true },
    });
    expect(inline.css).toContain('sourceMappingURL=data:application/json;base64,');
  });

  test(`${entry.name}: shared syntax-error contract`, async () => {
    const { service } = entry;
    for (const error of coreCssContract.errors) {
      await expect(
        service.process(error.css, { from: coreCssContract.from }),
        error.name,
      ).rejects.toMatchObject({
        name: 'CssSyntaxError',
        line: error.line,
        column: error.column,
        reason: error.reason,
      });
    }
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
  const wasmResult = await wasmProc.process(coreCssContract.mutation.css, {
    from: 'wasm-order.css',
  });
  expect(wasmResult.css).toBe(coreCssContract.mutation.expectedCss);
  expect(wasmEvents[0]).toBe('once');
  expect(wasmEvents.at(-1)).toBe('once-exit');
  expect(wasmEvents).toContain('decl:color');
  expect(wasmEvents).toContain('decl:display');
  await wasmProc.close();

  const nativeEvents: string[] = [];
  const native = createNativeService();
  try {
    const nativeResult = await new Processor([createOrderingPlugin(nativeEvents)]).process(
      coreCssContract.mutation.css,
      { from: 'native-order.css' },
      { service: native },
    );
    expect(nativeResult.css).toBe(coreCssContract.mutation.expectedCss);
    expect(nativeEvents).toEqual(wasmEvents);
  } finally {
    await native.close();
  }
});
