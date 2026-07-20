type WasmRequest = {
  id: number;
  method: 'parse' | 'process' | 'stringify';
  params: unknown;
};

type GoRuntime = {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
};

type WasmGlobal = typeof globalThis & {
  Go?: new () => GoRuntime;
  postcssGoWasmRequest?: (request: string) => string;
  postMessage(message: unknown): void;
};

const scope = globalThis as WasmGlobal & {
  onmessage: ((event: MessageEvent) => void) | null;
};

let ready: Promise<void> | null = null;

scope.onmessage = (event) => {
  const message = event.data as
    | WasmRequest
    | { type: 'init'; wasmUrl?: string; wasmExecUrl?: string };
  if ('type' in message && message.type === 'init') {
    ready = initialize(message.wasmUrl, message.wasmExecUrl);
    return;
  }

  void handleRequest(message as WasmRequest);
};

async function handleRequest(request: WasmRequest): Promise<void> {
  try {
    if (!ready) throw new Error('postcss-go WASM worker is not initialized');
    await ready;
    const handler = scope.postcssGoWasmRequest;
    if (!handler) throw new Error('postcss-go WASM request handler is unavailable');
    const params = request.params && typeof request.params === 'object' ? request.params : {};
    const response = JSON.parse(handler(JSON.stringify({ ...params, command: request.method })));
    if (response.error) {
      scope.postMessage({ id: request.id, error: response.error });
      return;
    }
    scope.postMessage({
      id: request.id,
      result:
        request.method === 'stringify'
          ? { css: response.css ?? '' }
          : request.method === 'parse'
            ? { root: response.root }
            : {
                css: response.css ?? '',
                map: response.map,
                root: response.root,
                messages: response.messages ?? [],
              },
    });
  } catch (error) {
    scope.postMessage({
      id: request.id,
      error: { message: error instanceof Error ? error.message : String(error) },
    });
  }
}

async function initialize(wasmUrl?: string, wasmExecUrl?: string): Promise<void> {
  if (!wasmUrl || !wasmExecUrl) throw new Error('wasmUrl and wasmExecUrl are required');
  const importScripts = (
    globalThis as typeof globalThis & {
      importScripts?: (...urls: string[]) => void;
    }
  ).importScripts;
  if (!importScripts) throw new Error('postcss-go WASM worker requires a classic Worker');
  importScripts(wasmExecUrl);
  if (!scope.Go) throw new Error('Go WASM runtime is unavailable');

  const go = new scope.Go();
  const response = await fetch(wasmUrl);
  const bytes = await response.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  void go.run(instance);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (scope.postcssGoWasmRequest) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('postcss-go WASM request handler did not initialize');
}
