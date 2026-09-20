/**
 * Main-thread Go/WASM handle transport. The browser plugin path owns its AST
 * inside this instance, so nodes are never serialized across a boundary.
 */
import { HANDLE_BRIDGE_METHODS } from '../generated/handle-protocol.js';
import type { HandleBridge, HandleBridgeError } from '../handle-session.js';
import { WasmWorkerError } from './errors.js';

type HandleEnvelope = { ok: true; value: unknown } | { ok: false; status: number; message: string };

/** Raw export table published by the Go instance as `postcssGoHandles`. */
export type HandleEnvelopeExports = Record<string, (...args: unknown[]) => HandleEnvelope>;

export interface MainThreadHandleBridgeOptions {
  wasmUrl?: string;
  wasmExecUrl?: string;
  /** Preloaded export table; skips asset loading for tests and custom hosts. */
  exports?: HandleEnvelopeExports;
}

type GoRuntime = {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
};

type HandleGlobal = typeof globalThis & {
  Go?: new () => GoRuntime;
  postcssGoHandles?: HandleEnvelopeExports;
};

function unwrap(method: string, envelope: HandleEnvelope): unknown {
  if (!envelope || typeof envelope !== 'object') {
    throw new WasmWorkerError(`postcss-go handle export '${method}' returned no envelope`);
  }
  if (envelope.ok) return envelope.value;
  const error = new Error(envelope.message) as HandleBridgeError;
  error.name = 'HandleBridgeError';
  error.status = envelope.status;
  throw error;
}

/**
 * Adapt the envelope-returning exports to the runtime-neutral bridge contract.
 * Go cannot throw across `js.FuncOf` without tearing down the instance, so
 * failures arrive as structured status envelopes and are rethrown here.
 */
export function createHandleBridge(exports: HandleEnvelopeExports): HandleBridge {
  const bridge: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of HANDLE_BRIDGE_METHODS) {
    const implementation = exports[method];
    if (typeof implementation !== 'function') {
      throw new WasmWorkerError(`postcss-go WASM handle export '${method}' is unavailable`);
    }
    bridge[method] = (...args: unknown[]) => unwrap(method, implementation(...args));
  }
  return bridge as unknown as HandleBridge;
}

/** Load `wasm_exec.js` so the Go runtime constructor becomes available. */
async function loadGoRuntime(scope: HandleGlobal, wasmExecUrl: string): Promise<void> {
  if (scope.Go) return;
  const host = (globalThis as typeof globalThis & { document?: Document }).document;
  if (host) {
    await new Promise<void>((resolve, reject) => {
      const script = host.createElement('script');
      script.src = wasmExecUrl;
      script.onload = () => resolve();
      script.onerror = () => reject(new WasmWorkerError(`Failed to load ${wasmExecUrl}`));
      host.head.append(script);
    });
  } else {
    await import(/* @vite-ignore */ wasmExecUrl);
  }
  if (!scope.Go) throw new WasmWorkerError('Go WASM runtime is unavailable');
}

async function instantiate(
  response: Response,
  importObject: WebAssembly.Imports,
): Promise<WebAssembly.WebAssemblyInstantiatedSource> {
  if (
    typeof WebAssembly.instantiateStreaming === 'function' &&
    typeof response.clone === 'function'
  ) {
    try {
      return await WebAssembly.instantiateStreaming(response.clone(), importObject);
    } catch {
      // Servers frequently omit application/wasm; retry from bytes so those
      // deployments keep working while correct MIME types still stream.
    }
  }
  return WebAssembly.instantiate(await response.arrayBuffer(), importObject);
}

/**
 * Boot a main-thread Go instance and return its handle bridge. Parse,
 * mutation, and stringify all run inside this instance.
 */
export async function loadMainThreadHandleBridge(
  options: MainThreadHandleBridgeOptions = {},
): Promise<HandleBridge> {
  if (options.exports) return createHandleBridge(options.exports);

  const scope = globalThis as HandleGlobal;
  // A Go instance already running in this realm owns an arena we can reuse,
  // so hosts that boot the runtime themselves do not pay for a second one.
  if (scope.postcssGoHandles) return createHandleBridge(scope.postcssGoHandles);

  const { wasmUrl, wasmExecUrl } = options;
  if (!wasmUrl || !wasmExecUrl) {
    throw new WasmWorkerError(
      'wasmUrl and wasmExecUrl are required to run the main-thread handle session',
    );
  }
  await loadGoRuntime(scope, wasmExecUrl);

  const go = new scope.Go!();
  const response = await fetch(wasmUrl);
  if (!response.ok) {
    throw new WasmWorkerError(`Failed to fetch WASM from ${wasmUrl}: HTTP ${response.status}`);
  }
  const { instance } = await instantiate(response, go.importObject);
  void go.run(instance).catch(() => {
    scope.postcssGoHandles = undefined;
  });

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (scope.postcssGoHandles) return createHandleBridge(scope.postcssGoHandles);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new WasmWorkerError('postcss-go WASM handle exports did not initialize');
}
