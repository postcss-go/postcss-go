import {
  materializePreviousMap,
  normalizeProcessOptions,
  type NormalizeProcessOptionsInput,
  type ProcessFileOptions,
} from 'postcss-go-shared/map-options';
import { joinMapAnnotationPath } from 'postcss-go-shared/map-path';

import { asProcessRoot, fromAst, toAst, type ProcessRoot } from '../ast.js';
import { assertSupportedAst } from '../ast-utils.js';
import { dispatchProcess } from '../dispatch.js';
import { SyncBackendUnavailableError } from '../errors.js';
import { WasmWorkerError, errorFromWasmDto, type WasmErrorDTO } from './errors.js';
import { attachInputMetadata } from '../input.js';
import type { AcceptedPlugin } from '../plugin-types.js';
import type { PluginResult } from '../plugin-runtime.js';
import { WASM_WORKER_BACKEND_CAPABILITIES, type PostcssGoService } from '../service.js';
import { prepareStringifyOptions } from '../source-map-output.js';
import type {
  AstNode,
  AstStringifyResult,
  DocumentNode,
  NoWorkResult,
  ParseResult,
  ProcessOptions,
  ProcessResult,
  RootNode,
} from '../types.js';

export interface BrowserWorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { error?: unknown; message?: string }) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

export interface BrowserPostcssGoServiceOptions {
  workerUrl?: string;
  wasmUrl?: string;
  wasmExecUrl?: string;
  worker?: BrowserWorkerLike;
  /** Reject pending RPC calls after this many milliseconds. Disabled when unset. */
  requestTimeoutMs?: number;
}

/**
 * Browser-facing processor: JavaScript plugins run on the calling thread while
 * parse/stringify use the Worker-backed WASM service. Synchronous APIs are not
 * available on this path.
 */
export interface BrowserProcessor {
  readonly service: BrowserPostcssGoService;
  process(css: string, options?: ProcessFileOptions): Promise<PluginResult>;
  close(): Promise<void>;
}

/** Create a browser processor bound to a Worker/WASM service owned by the helper. */
export function createBrowserProcessor(
  plugins: AcceptedPlugin[] = [],
  options: BrowserPostcssGoServiceOptions = {},
): BrowserProcessor {
  const service = new BrowserPostcssGoService(options);
  return {
    service,
    process(css, processOptions = {}) {
      return dispatchProcess(service, String(css), processOptions, plugins);
    },
    close() {
      return service.close();
    },
  };
}

/** Reject synchronous APIs against the async-only browser WASM Worker backend. */
export function rejectBrowserSyncApi(apiName: string): never {
  throw new SyncBackendUnavailableError(
    `${apiName} requires an in-process sync backend (Node N-API); the browser WASM Worker backend is asynchronous only`,
  );
}

export class BrowserPostcssGoService implements PostcssGoService {
  readonly capabilities = WASM_WORKER_BACKEND_CAPABILITIES;
  readonly workerUrl?: string;
  readonly wasmUrl?: string;
  readonly wasmExecUrl?: string;

  private readonly worker: BrowserWorkerLike;
  private readonly requestTimeoutMs?: number;
  private readonly pending = new Map<
    number,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();
  private nextId = 1;
  private closed = false;

  constructor(options: BrowserPostcssGoServiceOptions = {}) {
    this.workerUrl = options.workerUrl;
    this.wasmUrl = options.wasmUrl;
    this.wasmExecUrl = options.wasmExecUrl;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.worker = options.worker ?? createWorker(options.workerUrl);
    this.worker.onmessage = (event) => this.handleMessage(event.data);
    this.worker.onerror = (event) => {
      const message =
        event.error instanceof Error ? event.error.message : event.message || 'WASM worker failed';
      this.failService(new WasmWorkerError(message));
    };

    // Always init classic Workers we create. For injected workers, still send
    // init when asset URLs are provided so the Worker receives wasmUrl/wasmExecUrl.
    if (!options.worker || options.wasmUrl || options.wasmExecUrl) {
      this.worker.postMessage({
        type: 'init',
        wasmUrl: this.wasmUrl,
        wasmExecUrl: this.wasmExecUrl,
      });
    }
  }

  async parse(css: string, options: ProcessOptions = {}): Promise<ParseResult> {
    options = materializePreviousMap(options);
    return this.call<ParseResult>('parse', { css, options });
  }

  process(css: string, options: ProcessOptions = {}): Promise<ProcessResult> {
    options = materializePreviousMap(options);
    if (hasAnnotationCallback(options)) {
      return this.processWithAnnotation(css, options);
    }
    return this.call<ProcessResult>('process', {
      css,
      options: normalizeProcessOptions(
        options as NormalizeProcessOptionsInput,
        joinMapAnnotationPath,
      ) as ProcessOptions,
    }).then((result) => ({ ...result, backend: 'wasm-worker' }));
  }

  noWork(css: string, options: ProcessOptions = {}): Promise<NoWorkResult> {
    options = materializePreviousMap(options);
    if (hasAnnotationCallback(options)) {
      return this.resolveNoWorkAnnotation(options).then((resolved) =>
        this.call<NoWorkResult>('noWork', {
          css,
          options: normalizeProcessOptions(
            resolved as NormalizeProcessOptionsInput,
            joinMapAnnotationPath,
          ) as ProcessOptions,
        }),
      );
    }
    return this.call<NoWorkResult>('noWork', {
      css,
      options: normalizeProcessOptions(
        options as NormalizeProcessOptionsInput,
        joinMapAnnotationPath,
      ) as ProcessOptions,
    });
  }

  async stringify(ast: AstNode): Promise<string> {
    return (await this.stringifyResult(ast)).css;
  }

  async stringifyResult(ast: AstNode, options: ProcessOptions = {}): Promise<AstStringifyResult> {
    options = materializePreviousMap(options);
    assertSupportedAst(ast);
    const preparedOptions = prepareStringifyOptions(ast, options);
    const effectiveOptions = await this.resolveStringifyAnnotation(ast, preparedOptions);
    const result = await this.call<AstStringifyResult>('stringify', {
      ast,
      options: normalizeProcessOptions(
        effectiveOptions as NormalizeProcessOptionsInput,
        joinMapAnnotationPath,
      ) as ProcessOptions,
    });
    if (typeof result?.css !== 'string') {
      throw new WasmWorkerError('postcss-go WASM stringify response is missing css');
    }
    return result;
  }

  parseSync(_css: string, _options?: ProcessOptions): never {
    return rejectBrowserSyncApi('parseSync');
  }

  processSync(_css: string, _options?: ProcessOptions): never {
    return rejectBrowserSyncApi('processSync');
  }

  noWorkSync(_css: string, _options?: ProcessOptions): never {
    return rejectBrowserSyncApi('noWorkSync');
  }

  stringifySync(_ast: AstNode, _options?: ProcessOptions): never {
    return rejectBrowserSyncApi('stringifySync');
  }

  stringifyResultSync(_ast: AstNode, _options?: ProcessOptions): never {
    return rejectBrowserSyncApi('stringifyResultSync');
  }

  async close(): Promise<void> {
    this.failService(new WasmWorkerError('postcss-go WASM service closed'));
  }

  private call<T>(method: string, params: unknown): Promise<T> {
    if (this.closed) {
      return Promise.reject(new WasmWorkerError('postcss-go WASM service is closed'));
    }

    const id = this.nextId++;
    const pending = new Promise<T>((resolve, reject) => {
      const entry: {
        resolve: (result: unknown) => void;
        reject: (error: Error) => void;
        timer?: ReturnType<typeof setTimeout>;
      } = {
        resolve: resolve as (result: unknown) => void,
        reject,
      };
      if (this.requestTimeoutMs !== undefined && this.requestTimeoutMs > 0) {
        entry.timer = setTimeout(() => {
          if (!this.pending.delete(id)) return;
          reject(
            new WasmWorkerError(
              `postcss-go WASM request timed out after ${this.requestTimeoutMs}ms (${method})`,
            ),
          );
        }, this.requestTimeoutMs);
      }
      this.pending.set(id, entry);
    });
    try {
      this.worker.postMessage({ id, method, params });
    } catch (error) {
      const entry = this.pending.get(id);
      if (entry?.timer) clearTimeout(entry.timer);
      this.pending.delete(id);
      return Promise.reject(
        error instanceof WasmWorkerError
          ? error
          : new WasmWorkerError(error instanceof Error ? error.message : String(error)),
      );
    }
    return pending;
  }

  private async processWithAnnotation(
    css: string,
    options: ProcessOptions,
  ): Promise<ProcessResult> {
    // Match the native path: parse once, resolve the annotation against the
    // same live tree (with Input metadata), then stringify — avoid a second
    // Go parse via `process`.
    const parseOptions = normalizeProcessOptions(
      options as NormalizeProcessOptionsInput,
      joinMapAnnotationPath,
    ) as ProcessOptions;
    const parsed = await this.parse(css, parseOptions);
    const live = asProcessRoot(fromAst(parsed.root));
    attachInputMetadata(live, css, options);
    const effective = await this.resolveStringifyAnnotationLive(live, options);
    const root = toAst(live) as RootNode | DocumentNode;
    const stringified = await this.stringifyResult(root, effective);
    return { ...stringified, root, messages: [], backend: 'wasm-worker' };
  }

  private async resolveNoWorkAnnotation(options: ProcessOptions): Promise<ProcessOptions> {
    const map = options.map;
    if (!map || typeof map !== 'object' || typeof map.annotation !== 'function') return options;
    const annotation = await (
      map.annotation as (file?: string, root?: unknown) => string | Promise<string>
    )(options.to, undefined);
    return { ...options, map: { ...map, annotation } };
  }

  private async resolveStringifyAnnotation(
    root: AstNode,
    options: ProcessOptions,
  ): Promise<ProcessOptions> {
    if (
      !options.map ||
      typeof options.map !== 'object' ||
      typeof options.map.annotation !== 'function'
    ) {
      return options;
    }
    const live = asProcessRoot(fromAst(root));
    const annotation = await options.map.annotation(options.to, live as never);
    return { ...options, map: { ...options.map, annotation } };
  }

  /** Resolve annotation against an already-hydrated live root (preserves Input). */
  private async resolveStringifyAnnotationLive(
    live: ProcessRoot,
    options: ProcessOptions,
  ): Promise<ProcessOptions> {
    if (
      !options.map ||
      typeof options.map !== 'object' ||
      typeof options.map.annotation !== 'function'
    ) {
      return options;
    }
    const annotation = await options.map.annotation(options.to, live as never);
    return { ...options, map: { ...options.map, annotation } };
  }

  private handleMessage(message: unknown): void {
    if (!message || typeof message !== 'object') return;
    const response = message as {
      type?: string;
      id?: unknown;
      result?: unknown;
      error?: WasmErrorDTO;
    };

    if (response.type === 'ready') return;
    if (response.type === 'runtime-error') {
      this.failService(
        new WasmWorkerError(response.error?.message || 'postcss-go WASM runtime failed'),
      );
      return;
    }

    if (typeof response.id !== 'number') return;

    const request = this.pending.get(response.id);
    if (!request) return;
    this.pending.delete(response.id);
    if (request.timer) clearTimeout(request.timer);

    if (response.error) {
      request.reject(errorFromWasmDto(response.error));
      return;
    }
    request.resolve(response.result);
  }

  /** Mark the service unusable, reject pending RPCs, and terminate the Worker. */
  private failService(error: Error): void {
    if (this.closed) {
      this.rejectAll(error);
      return;
    }
    this.closed = true;
    this.rejectAll(error);
    try {
      this.worker.postMessage({ type: 'shutdown' });
    } catch {
      // Worker may already be dead; terminate regardless.
    }
    try {
      this.worker.terminate();
    } catch {
      // Ignore terminate failures from already-dead Workers.
    }
  }

  private rejectAll(error: Error): void {
    for (const request of this.pending.values()) {
      if (request.timer) clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}

function createWorker(workerUrl?: string): BrowserWorkerLike {
  if (!workerUrl || typeof Worker === 'undefined') {
    throw new WasmWorkerError(
      'A classic Worker-compatible runtime and workerUrl are required for the browser WASM service',
    );
  }
  return new Worker(workerUrl) as unknown as BrowserWorkerLike;
}

function hasAnnotationCallback(options: ProcessOptions): boolean {
  return (
    !!options.map && typeof options.map === 'object' && typeof options.map.annotation === 'function'
  );
}
