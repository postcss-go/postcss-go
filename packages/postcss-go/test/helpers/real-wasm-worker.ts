import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

import type { BrowserWorkerLike } from '../../src/wasm/index.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const distRoot = resolve(packageRoot, 'dist/wasm');

type GoRuntime = {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
};

type WasmGlobal = typeof globalThis & {
  Go?: new () => GoRuntime;
  postcssGoWasmRequest?: (request: string) => string;
};

let wasmReady: Promise<WasmGlobal> | undefined;

/** Load the published Go WASM runtime once for integration tests. */
export async function loadRealWasmRuntime(): Promise<WasmGlobal> {
  if (!wasmReady) {
    wasmReady = (async () => {
      const require = createRequire(import.meta.url);
      require(resolve(distRoot, 'wasm_exec.js'));
      const scope = globalThis as WasmGlobal;
      if (!scope.Go) {
        throw new Error('Go WASM runtime did not register globalThis.Go');
      }
      const go = new scope.Go();
      const bytes = readFileSync(resolve(distRoot, 'postcss-go.wasm'));
      const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
      void go.run(instance);
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (scope.postcssGoWasmRequest) return scope;
        await new Promise((resolveReady) => setTimeout(resolveReady, 0));
      }
      throw new Error('postcss-go WASM request handler did not initialize');
    })();
  }
  return wasmReady;
}

/**
 * Worker-like transport that drives the same JSON RPC as the classic browser
 * Worker, backed by the real Go WASM binary instead of a mocked handler.
 */
export class RealWasmWorker implements BrowserWorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { error?: unknown; message?: string }) => void) | null = null;
  private ready: Promise<WasmGlobal> | null = null;
  private terminated = false;

  postMessage(message: unknown): void {
    if (this.terminated) {
      throw new Error('postcss-go WASM worker terminated');
    }
    if (
      message &&
      typeof message === 'object' &&
      'type' in message &&
      (message as { type?: string }).type === 'init'
    ) {
      this.ready = loadRealWasmRuntime();
      return;
    }

    const request = message as { id: number; method: string; params: unknown };
    void this.handleRequest(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  private async handleRequest(request: { id: number; method: string; params: unknown }) {
    try {
      const scope = await (this.ready ?? loadRealWasmRuntime());
      const handler = scope.postcssGoWasmRequest;
      if (!handler) throw new Error('postcss-go WASM request handler is unavailable');
      const params = request.params && typeof request.params === 'object' ? request.params : {};
      const response = JSON.parse(
        handler(JSON.stringify({ ...params, command: request.method })),
      ) as {
        css?: string;
        map?: unknown;
        mapFile?: string;
        root?: unknown;
        messages?: unknown[];
        error?: { message?: string; name?: string };
      };
      if (response.error) {
        this.onmessage?.({ data: { id: request.id, error: response.error } });
        return;
      }
      this.onmessage?.({
        data: {
          id: request.id,
          result:
            request.method === 'stringify'
              ? {
                  css: response.css ?? '',
                  map: response.map,
                  ...(response.mapFile ? { mapFile: response.mapFile } : {}),
                }
              : request.method === 'parse'
                ? { root: response.root }
                : request.method === 'noWork'
                  ? {
                      css: response.css ?? '',
                      map: response.map,
                      ...(response.mapFile ? { mapFile: response.mapFile } : {}),
                    }
                  : {
                      css: response.css ?? '',
                      map: response.map,
                      ...(response.mapFile ? { mapFile: response.mapFile } : {}),
                      root: response.root,
                      messages: response.messages ?? [],
                    },
        },
      });
    } catch (error) {
      this.onmessage?.({
        data: {
          id: request.id,
          error: { message: error instanceof Error ? error.message : String(error) },
        },
      });
    }
  }
}

export function wasmAssetUrls() {
  return {
    workerUrl: pathToFileURL(resolve(distRoot, 'worker.js')).href,
    wasmUrl: pathToFileURL(resolve(distRoot, 'postcss-go.wasm')).href,
    wasmExecUrl: pathToFileURL(resolve(distRoot, 'wasm_exec.js')).href,
  };
}
