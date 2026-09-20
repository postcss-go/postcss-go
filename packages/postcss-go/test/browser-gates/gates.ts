/** Phase 8 harness: Worker-only DTO vs main-thread Go AST. Driven by `scripts/measure-browser-handle-gates.mjs`. */
import { createBrowserProcessor } from '@postcss-go/core/wasm';
import wasmUrl from '@postcss-go/core/wasm/postcss-go.wasm?url';
import wasmExecUrl from '@postcss-go/core/wasm/wasm_exec.js?url';
import workerUrl from '@postcss-go/core/wasm/worker?url';

type Sample = {
  bootMs: number;
  medianProcessMs: number;
  peakMemoryBytes?: number;
  wasmInstances: number;
  cssLength: number;
};

declare global {
  var __postcssGoGates:
    | { status: 'pending' }
    | {
        status: 'passed';
        worker: Sample;
        handle: Sample;
        iterations: number;
        crossOriginIsolated: boolean;
      }
    | { status: 'failed'; message: string; stack?: string };
}

const ITERATIONS = 25;
globalThis.__postcssGoGates = { status: 'pending' };

const css = Array.from(
  { length: 120 },
  (_, index) =>
    `@media screen and (min-width: ${300 + index}px) {\n` +
    `  .block-${index} .child > a:hover {\n` +
    `    color: red;\n` +
    `    margin: ${index}px ${index}px;\n` +
    `    padding-inline: calc(1rem + ${index}px);\n` +
    `  }\n}\n`,
).join('\n');

const plugins = [
  {
    postcssPlugin: 'gate-mutation',
    Declaration(decl: { prop: string; value: string }) {
      if (decl.prop === 'color') decl.value = 'blue';
    },
  },
];

async function measureMemory(): Promise<number | undefined> {
  const api = (
    performance as Performance & {
      measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
    }
  ).measureUserAgentSpecificMemory;
  try {
    return api ? (await api.call(performance)).bytes : undefined;
  } catch {
    return undefined;
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

async function sample(mainThreadAst: boolean): Promise<Sample & { css: string }> {
  const processor = createBrowserProcessor(plugins, {
    workerUrl,
    wasmUrl,
    wasmExecUrl,
    mainThreadAst,
    requestTimeoutMs: 60_000,
  });
  try {
    const bootStart = performance.now();
    const first = await processor.process(css, { from: 'gates.css', map: false });
    const durations: number[] = [];
    for (let index = 0; index < ITERATIONS; index += 1) {
      const start = performance.now();
      await processor.process(css, { from: 'gates.css', map: false });
      durations.push(performance.now() - start);
    }
    return {
      bootMs: performance.now() - bootStart,
      medianProcessMs: median(durations),
      peakMemoryBytes: await measureMemory(),
      wasmInstances: mainThreadAst ? 2 : 1,
      cssLength: first.css.length,
      css: first.css,
    };
  } finally {
    await processor.close();
  }
}

void (async () => {
  try {
    const { css: workerCss, ...worker } = await sample(false);
    const { css: handleCss, ...handle } = await sample(true);
    if (workerCss !== handleCss) {
      throw new Error('transports produced different CSS; gate comparison is meaningless');
    }
    globalThis.__postcssGoGates = {
      status: 'passed',
      worker,
      handle,
      iterations: ITERATIONS,
      crossOriginIsolated: globalThis.crossOriginIsolated === true,
    };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    globalThis.__postcssGoGates = {
      status: 'failed',
      message: failure.message,
      stack: failure.stack,
    };
  }
})();
