import { afterEach, expect, test, vi } from 'vitest';

type WorkerScope = typeof globalThis & {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (message: unknown) => void;
  Go?: new () => {
    importObject: WebAssembly.Imports;
    run(instance: WebAssembly.Instance): Promise<void>;
  };
  postcssGoWasmRequest?: (request: string) => string;
  importScripts?: (...urls: string[]) => void;
};

const scope = globalThis as WorkerScope;
const originalOnmessage = scope.onmessage;
const originalPostMessage = scope.postMessage;
const originalGo = scope.Go;
const originalHandler = scope.postcssGoWasmRequest;
const originalImportScripts = scope.importScripts;
const originalFetch = globalThis.fetch;
const originalInstantiate = WebAssembly.instantiate;

afterEach(() => {
  scope.onmessage = originalOnmessage;
  scope.postMessage = originalPostMessage;
  scope.Go = originalGo;
  scope.postcssGoWasmRequest = originalHandler;
  scope.importScripts = originalImportScripts;
  globalThis.fetch = originalFetch;
  WebAssembly.instantiate = originalInstantiate;
  vi.resetModules();
  vi.restoreAllMocks();
});

async function loadWorker() {
  vi.resetModules();
  await import('../src/worker.ts');
  expect(scope.onmessage).toEqual(expect.any(Function));
  return scope.onmessage!;
}

test('worker rejects requests before initialization', async () => {
  const messages: unknown[] = [];
  scope.postMessage = (message) => {
    messages.push(message);
  };

  const onmessage = await loadWorker();
  onmessage({ data: { id: 1, method: 'parse', params: { css: 'a{}' } } } as MessageEvent);
  await vi.waitFor(() => expect(messages).toHaveLength(1));

  expect(messages[0]).toEqual({
    id: 1,
    error: { message: 'postcss-go WASM worker is not initialized' },
  });
});

test('worker requires classic Worker importScripts and wasm URLs', async () => {
  const messages: unknown[] = [];
  scope.postMessage = (message) => {
    messages.push(message);
  };
  delete scope.importScripts;

  const onmessage = await loadWorker();
  onmessage({ data: { type: 'init' } } as MessageEvent);
  onmessage({ data: { id: 2, method: 'parse', params: { css: 'a{}' } } } as MessageEvent);
  await vi.waitFor(() => expect(messages).toHaveLength(1));
  expect(messages[0]).toMatchObject({
    id: 2,
    error: { message: 'wasmUrl and wasmExecUrl are required' },
  });

  messages.length = 0;
  onmessage({
    data: { type: 'init', wasmUrl: '/runtime.wasm', wasmExecUrl: '/wasm_exec.js' },
  } as MessageEvent);
  onmessage({ data: { id: 3, method: 'parse', params: { css: 'a{}' } } } as MessageEvent);
  await vi.waitFor(() => expect(messages).toHaveLength(1));
  expect(messages[0]).toMatchObject({
    id: 3,
    error: { message: 'postcss-go WASM worker requires a classic Worker' },
  });
});

test('worker initializes Go runtime and dispatches method responses', async () => {
  const messages: unknown[] = [];
  const imported: string[] = [];
  scope.postMessage = (message) => {
    messages.push(message);
  };
  scope.importScripts = (...urls) => {
    imported.push(...urls);
    scope.Go = class {
      importObject = {} as WebAssembly.Imports;
      async run() {
        scope.postcssGoWasmRequest = (request) => {
          const payload = JSON.parse(request) as { command: string; css?: string };
          if (payload.command === 'parse') {
            return JSON.stringify({ root: { type: 'root', nodes: [] } });
          }
          if (payload.command === 'stringify') {
            return JSON.stringify({ map: null });
          }
          if (payload.command === 'noWork') {
            return JSON.stringify({ map: null });
          }
          if (payload.command === 'process') {
            return JSON.stringify({
              map: null,
              root: { type: 'root', nodes: [] },
            });
          }
          return JSON.stringify({ error: { message: `unknown ${payload.command}` } });
        };
      }
    };
  };
  globalThis.fetch = vi.fn(async () => ({
    arrayBuffer: async () => new ArrayBuffer(8),
  })) as typeof fetch;
  WebAssembly.instantiate = vi.fn(async () => ({
    instance: {} as WebAssembly.Instance,
    module: {} as WebAssembly.Module,
  })) as typeof WebAssembly.instantiate;

  const onmessage = await loadWorker();
  onmessage({
    data: { type: 'init', wasmUrl: '/runtime.wasm', wasmExecUrl: '/wasm_exec.js' },
  } as MessageEvent);

  onmessage({ data: { id: 1, method: 'parse', params: { css: 'a{}' } } } as MessageEvent);
  await vi.waitFor(() => expect(messages).toHaveLength(1));
  expect(imported).toEqual(['/wasm_exec.js']);
  expect(messages[0]).toEqual({ id: 1, result: { root: { type: 'root', nodes: [] } } });

  onmessage({
    data: { id: 2, method: 'stringify', params: { css: '.a{}' } },
  } as MessageEvent);
  await vi.waitFor(() => expect(messages).toHaveLength(2));
  expect(messages[1]).toEqual({ id: 2, result: { css: '', map: null } });

  onmessage({ data: { id: 3, method: 'noWork', params: { css: '.b{}' } } } as MessageEvent);
  await vi.waitFor(() => expect(messages).toHaveLength(3));
  expect(messages[2]).toEqual({ id: 3, result: { css: '', map: null } });

  onmessage({ data: { id: 4, method: 'process', params: null } } as MessageEvent);
  await vi.waitFor(() => expect(messages).toHaveLength(4));
  expect(messages[3]).toEqual({
    id: 4,
    result: {
      css: '',
      map: null,
      root: { type: 'root', nodes: [] },
      messages: [],
    },
  });
});

function mockWasmBootstrap(run: () => void | Promise<void>) {
  scope.importScripts = () => {
    scope.Go = class {
      importObject = {} as WebAssembly.Imports;
      async run() {
        await run();
      }
    };
  };
  globalThis.fetch = vi.fn(async () => ({
    arrayBuffer: async () => new ArrayBuffer(8),
  })) as typeof fetch;
  WebAssembly.instantiate = vi.fn(async () => ({
    instance: {} as WebAssembly.Instance,
    module: {} as WebAssembly.Module,
  })) as typeof WebAssembly.instantiate;
}

test('worker surfaces handler errors and missing Go runtime', async () => {
  const messages: unknown[] = [];
  scope.postMessage = (message) => {
    messages.push(message);
  };
  scope.importScripts = () => {
    // Leave Go undefined intentionally.
  };
  globalThis.fetch = vi.fn() as typeof fetch;

  const onmessage = await loadWorker();
  onmessage({
    data: { type: 'init', wasmUrl: '/runtime.wasm', wasmExecUrl: '/wasm_exec.js' },
  } as MessageEvent);
  onmessage({ data: { id: 1, method: 'parse', params: { css: 'a{}' } } } as MessageEvent);
  await vi.waitFor(() => expect(messages).toHaveLength(1));
  expect(messages[0]).toMatchObject({
    id: 1,
    error: { message: 'Go WASM runtime is unavailable' },
  });

  messages.length = 0;
  mockWasmBootstrap(() => {
    scope.postcssGoWasmRequest = () => JSON.stringify({ error: { message: 'bad css' } });
  });

  vi.resetModules();
  const onmessageReady = await loadWorker();
  onmessageReady({
    data: { type: 'init', wasmUrl: '/runtime.wasm', wasmExecUrl: '/wasm_exec.js' },
  } as MessageEvent);
  onmessageReady({ data: { id: 2, method: 'parse', params: { css: '{' } } } as MessageEvent);
  await vi.waitFor(() => expect(messages).toHaveLength(1));
  expect(messages[0]).toEqual({ id: 2, error: { message: 'bad css' } });
});

test('worker times out when the Go handler never appears', async () => {
  vi.useFakeTimers();
  const messages: unknown[] = [];
  scope.postMessage = (message) => {
    messages.push(message);
  };
  mockWasmBootstrap(() => {
    // Intentionally leave postcssGoWasmRequest unset.
  });

  try {
    const onmessage = await loadWorker();
    onmessage({
      data: { type: 'init', wasmUrl: '/runtime.wasm', wasmExecUrl: '/wasm_exec.js' },
    } as MessageEvent);
    onmessage({ data: { id: 1, method: 'parse', params: { css: 'a{}' } } } as MessageEvent);

    await vi.runAllTimersAsync();
    await vi.waitFor(() => expect(messages).toHaveLength(1));
    expect(messages[0]).toEqual({
      id: 1,
      error: { message: 'postcss-go WASM request handler did not initialize' },
    });
  } finally {
    vi.useRealTimers();
  }
});

test('worker reports missing handlers and non-Error throws', async () => {
  const messages: unknown[] = [];
  scope.postMessage = (message) => {
    messages.push(message);
  };
  mockWasmBootstrap(() => {
    scope.postcssGoWasmRequest = () => {
      throw 'raw failure';
    };
  });

  const onmessage = await loadWorker();
  onmessage({
    data: { type: 'init', wasmUrl: '/runtime.wasm', wasmExecUrl: '/wasm_exec.js' },
  } as MessageEvent);
  onmessage({ data: { id: 1, method: 'process', params: { css: 'a{}' } } } as MessageEvent);
  await vi.waitFor(() => expect(messages).toHaveLength(1));
  expect(messages[0]).toEqual({ id: 1, error: { message: 'raw failure' } });

  messages.length = 0;
  delete scope.postcssGoWasmRequest;
  // Keep ready resolved from the previous init, then force a request without a handler.
  mockWasmBootstrap(async () => {
    await Promise.resolve();
  });
  vi.resetModules();
  const onmessageMissing = await loadWorker();
  let resolveReady!: () => void;
  const gate = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  scope.importScripts = () => {
    scope.Go = class {
      importObject = {} as WebAssembly.Imports;
      async run() {
        scope.postcssGoWasmRequest = () => JSON.stringify({ css: 'ok' });
        resolveReady();
      }
    };
  };
  onmessageMissing({
    data: { type: 'init', wasmUrl: '/runtime.wasm', wasmExecUrl: '/wasm_exec.js' },
  } as MessageEvent);
  await gate;
  delete scope.postcssGoWasmRequest;
  onmessageMissing({ data: { id: 2, method: 'noWork', params: { css: 'a{}' } } } as MessageEvent);
  await vi.waitFor(() => expect(messages).toHaveLength(1));
  expect(messages[0]).toEqual({
    id: 2,
    error: { message: 'postcss-go WASM request handler is unavailable' },
  });
});
