import upstream from 'postcss';
import { afterAll, expect, test } from 'vitest';

import { Processor } from '../src/processor.ts';
import { createNativeService } from '../src/native.ts';
import { createBrowserProcessor } from '../src/wasm/browser.ts';
import type { AcceptedPlugin } from '../src/plugin-types.ts';
import { RealWasmWorker } from './helpers/real-wasm-worker.ts';
import {
  asyncColorCss,
  asyncColorPlugin,
  createContextPlugin,
  nestedMutationCss,
  nestedMutationPlugin,
  pluginContractFrom,
  pluginContractTo,
  willChangeCss,
  willChangePlugin,
} from './helpers/plugin-contract.ts';

type ContractResult = {
  css: string;
  messages: Array<Record<string, unknown>>;
  warnings: Array<{ text?: string; plugin?: string }>;
  lastPluginName?: string;
  backend?: string;
};

type ContractBackend = {
  name: string;
  process(
    plugins: AcceptedPlugin[],
    css: string,
    options?: { from?: string; to?: string; map?: boolean },
  ): Promise<ContractResult>;
  close(): Promise<void>;
};

function normalizeCss(css: string): string {
  return css.replace(/\s+/g, ' ').trim();
}

function toContractResult(result: {
  css: string;
  messages: Array<Record<string, unknown>>;
  warnings?: () => Array<{ text?: string; plugin?: string }>;
  lastPlugin?: { postcssPlugin?: string } | ((...args: never[]) => unknown);
  backend?: string;
}): ContractResult {
  const lastPlugin = result.lastPlugin;
  return {
    css: result.css,
    messages: result.messages,
    warnings:
      result.warnings?.().map((warning) => ({ text: warning.text, plugin: warning.plugin })) ??
      result.messages
        .filter((message) => message.type === 'warning')
        .map((warning) => ({
          text: typeof warning.text === 'string' ? warning.text : undefined,
          plugin: typeof warning.plugin === 'string' ? warning.plugin : undefined,
        })),
    lastPluginName:
      typeof lastPlugin === 'function' ? lastPlugin.name || undefined : lastPlugin?.postcssPlugin,
    backend: result.backend,
  };
}

function createNativeBackend(): ContractBackend {
  const service = createNativeService();
  return {
    name: 'native',
    async process(plugins, css, options) {
      const result = await new Processor(plugins).process(
        css,
        { from: pluginContractFrom, to: pluginContractTo, map: false, ...options },
        { service },
      );
      return toContractResult(result);
    },
    close: () => service.close(),
  };
}

function createWasmBackend(): ContractBackend {
  const owned: Array<{ close(): Promise<void> }> = [];
  return {
    name: 'wasm-worker',
    async process(plugins, css, options) {
      const processor = createBrowserProcessor(plugins, { worker: new RealWasmWorker() });
      owned.push(processor);
      const result = await processor.process(css, {
        from: pluginContractFrom,
        to: pluginContractTo,
        map: false,
        ...options,
      });
      return toContractResult(result);
    },
    async close() {
      await Promise.all(owned.map((processor) => processor.close()));
    },
  };
}

function createUpstreamBackend(): ContractBackend {
  return {
    name: 'upstream-postcss',
    async process(plugins, css, options) {
      const result = await upstream(plugins as never).process(css, {
        from: pluginContractFrom,
        to: pluginContractTo,
        map: false,
        ...options,
      });
      return toContractResult({
        css: result.css,
        messages: result.messages as Array<Record<string, unknown>>,
        warnings: () => result.warnings(),
        lastPlugin: result.lastPlugin as { postcssPlugin?: string },
      });
    },
    async close() {},
  };
}

const backends = [createNativeBackend(), createWasmBackend(), createUpstreamBackend()];

afterAll(async () => {
  for (const backend of backends) await backend.close();
});

for (const backend of backends) {
  test(`${backend.name}: plugin context, warnings, and dependency messages`, async () => {
    const events: string[] = [];
    const result = await backend.process([createContextPlugin(events)], '.a { color: red }');

    expect(events[0]).toBe('once');
    expect(events.at(-1)).toBe('once-exit');
    expect(events).toContain('decl:color');
    expect(result.lastPluginName).toBe('context-probe');
    expect(result.warnings).toEqual([
      expect.objectContaining({ text: 'from-result', plugin: 'context-probe' }),
      expect.objectContaining({ text: 'checked', plugin: 'context-probe' }),
    ]);
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'dependency',
          file: 'tokens.css',
          parent: pluginContractFrom,
        }),
        expect.objectContaining({
          type: 'dir-dependency',
          dir: 'components',
          glob: '**/*.css',
          parent: pluginContractFrom,
        }),
      ]),
    );
    if (backend.name !== 'upstream-postcss') {
      expect(result.backend).toBe(backend.name === 'native' ? 'native' : 'wasm-worker');
    }
  });

  test(`${backend.name}: mutation-heavy visitors match the shared CSS contract`, async () => {
    const willChange = await backend.process([willChangePlugin], willChangeCss);
    expect(willChange.css).toContain('backface-visibility: hidden');
    expect(willChange.css).toContain('will-change: transform');

    const nested = await backend.process([nestedMutationPlugin], nestedMutationCss);
    expect(nested.css).toContain('.card .title');
    expect(nested.css).toContain('font-weight: bold');
    expect(nested.css).toContain('color: red');
  });

  test(`${backend.name}: asynchronous visitors mutate the live tree`, async () => {
    const result = await backend.process([asyncColorPlugin], asyncColorCss);
    expect(result.css).toContain('navy');
    expect(result.lastPluginName).toBe('async-to-navy');
  });
}

test('native, WASM Worker, and upstream PostCSS share plugin CSS and messages', async () => {
  const events = { native: [] as string[], wasm: [] as string[], upstream: [] as string[] };
  const plugins = {
    native: [willChangePlugin, createContextPlugin(events.native)],
    wasm: [willChangePlugin, createContextPlugin(events.wasm)],
    upstream: [willChangePlugin, createContextPlugin(events.upstream)],
  };

  const [native, wasm, upstreamResult] = await Promise.all([
    backends[0].process(plugins.native, willChangeCss),
    backends[1].process(plugins.wasm, willChangeCss),
    backends[2].process(plugins.upstream, willChangeCss),
  ]);

  expect(normalizeCss(native.css)).toBe(normalizeCss(upstreamResult.css));
  expect(normalizeCss(wasm.css)).toBe(normalizeCss(upstreamResult.css));
  expect(native.warnings.map((warning) => warning.text)).toEqual(
    upstreamResult.warnings.map((warning) => warning.text),
  );
  expect(wasm.warnings.map((warning) => warning.text)).toEqual(
    upstreamResult.warnings.map((warning) => warning.text),
  );
  expect(events.native).toEqual(events.upstream);
  expect(events.wasm).toEqual(events.upstream);
});
