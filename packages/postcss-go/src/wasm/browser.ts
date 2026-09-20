import {
  materializePreviousMap,
  normalizeProcessOptions,
  type NormalizeProcessOptionsInput,
  type ProcessFileOptions,
} from '@postcss-go/shared/map-options';
import { joinMapAnnotationPath } from '@postcss-go/shared/map-path';

import {
  asProcessRoot,
  fromAst,
  fromJSONLocal,
  Node,
  setConstructedNodeIntern,
  type ProcessRoot,
} from '../ast.js';
import {
  internDetached,
  isGoOwned,
  parseRetained,
  setDefaultHandleBridge,
} from '../retained-session.js';
import { assertSupportedAst } from '../ast-utils.js';
import { attachInputMetadata, annotateOwnedInput } from '../input.js';
import { dispatchProcess } from '../dispatch.js';
import { ownerOf } from '../handle-facade.js';
import { SyncBackendUnavailableError } from '../errors.js';
import { WasmWorkerError, errorFromWasmDto, type WasmErrorDTO } from './errors.js';
import type { HandleBridge } from '../handle-session.js';
import { loadMainThreadHandleBridge, type MainThreadHandleBridgeOptions } from './handle-bridge.js';
import type { AcceptedPlugin } from '../plugin-types.js';
import type { PluginResult } from '../plugin-runtime.js';
import { WASM_WORKER_BACKEND_CAPABILITIES, type PostcssGoService } from '../service.js';
import { prepareStringifyOptions, finalizeMappedCSS } from '../source-map-output.js';
import { stringifyDocumentChildren } from '../document-stringify.js';
import type {
  AstNode,
  AstStringifyResult,
  NoWorkResult,
  ParseResult,
  ProcessOptions,
  ProcessResult,
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
  /** Preloaded main-thread handle exports; skips asset loading in tests. */
  handleExports?: MainThreadHandleBridgeOptions['exports'];
  /** Ready-made main-thread handle transport; skips WASM boot entirely. */
  handleBridge?: HandleBridge;
  /**
   * Run the plugin AST in a main-thread Go instance. Disabling it keeps every
   * operation on the Worker DTO transport, which is the documented escape
   * hatch when a host cannot afford a second instance.
   */
  mainThreadAst?: boolean;
}

/**
 * Browser-facing processor: JavaScript plugins run on the calling thread
 * against a main-thread Go AST session, so nodes are never serialized. The
 * Worker still serves string-in/string-out work. Synchronous public APIs are
 * not available on this path.
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
    async process(css, processOptions = {}) {
      await service.ensureHandleBridge();
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
  /** Main-thread Go AST transport; null until `ensureHandleBridge` resolves. */
  handleBridge: HandleBridge | null = null;

  private handleBridgeLoad?: Promise<HandleBridge | null>;
  private readonly handleExports?: MainThreadHandleBridgeOptions['exports'];
  private readonly mainThreadAst: boolean;
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
    this.handleExports = options.handleExports;
    this.mainThreadAst = options.mainThreadAst !== false;
    this.handleBridge = (this.mainThreadAst ? options.handleBridge : undefined) ?? null;
    if (this.handleBridge) {
      setDefaultHandleBridge(this.handleBridge);
      setConstructedNodeIntern(internDetached);
    }
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

  /**
   * Boot the main-thread AST session once. Asset-loading failures leave the
   * bridge null so the service keeps working through the Worker transport.
   */
  async ensureHandleBridge(): Promise<HandleBridge | null> {
    if (!this.mainThreadAst) return null;
    if (this.handleBridge) return this.handleBridge;
    this.handleBridgeLoad ??= loadMainThreadHandleBridge({
      wasmUrl: this.wasmUrl,
      wasmExecUrl: this.wasmExecUrl,
      exports: this.handleExports,
    }).then(
      (bridge) => {
        this.handleBridge = bridge;
        setDefaultHandleBridge(bridge);
        setConstructedNodeIntern(internDetached);
        return bridge;
      },
      () => {
        // Retry on the next dispatch: a host that boots the Go runtime itself
        // may not have published its exports yet.
        this.handleBridgeLoad = undefined;
        return null;
      },
    );
    return this.handleBridgeLoad;
  }

  async parse(css: string, options: ProcessOptions = {}): Promise<ParseResult> {
    this.assertOpen();
    options = materializePreviousMap(options);
    if (this.handleBridge) {
      return {
        root: parseRetained(this.handleBridge, css, { from: options.from, map: options.map }),
      };
    }
    if (this.shouldLoadHandleBridge()) {
      const bridge = await this.ensureHandleBridge();
      if (bridge) {
        return { root: parseRetained(bridge, css, { from: options.from, map: options.map }) };
      }
    }
    return this.call<ParseResult>('parse', { css, options });
  }

  /** Avoid an extra tick when this service has no main-thread assets to boot. */
  private shouldLoadHandleBridge(): boolean {
    if (!this.mainThreadAst) return false;
    if (this.handleExports) return true;
    if (this.wasmUrl && this.wasmExecUrl) return true;
    return typeof (globalThis as { postcssGoHandles?: unknown }).postcssGoHandles === 'object';
  }

  process(css: string, options: ProcessOptions = {}): Promise<ProcessResult> {
    this.assertOpen();
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
    this.assertOpen();
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

  async stringifyResult(
    ast: AstNode | ProcessRoot,
    options: ProcessOptions = {},
  ): Promise<AstStringifyResult> {
    this.assertOpen();
    options = materializePreviousMap(options);
    const live = ast instanceof Node ? ast : internDetached(fromAst(ast));
    const owner = ownerOf(live);
    const handle = owner?.handleId(live);
    if (live instanceof Node && live.type === 'document' && (!owner || handle === undefined)) {
      const css = stringifyDocumentChildren(live, (child) => {
        const childOwner = ownerOf(child);
        const childHandle = childOwner?.handleId(child);
        if (!childOwner || childHandle === undefined) {
          throw new WasmWorkerError('postcss-go stringify requires a Go-owned tree');
        }
        childOwner.flushPatches();
        return childOwner.session.stringify(childHandle);
      });
      if (!options.map) return { css };
      const first = (live as { first?: Node }).first;
      const firstOwner = first ? ownerOf(first) : undefined;
      const firstHandle = first && firstOwner ? firstOwner.handleId(first) : undefined;
      if (!first || !firstOwner || firstHandle === undefined) return { css };
      const mapOpts = options.map && typeof options.map === 'object' ? options.map : {};
      const mapped = firstOwner.session.stringifyMap(firstHandle, {
        from: options.from,
        to: options.to,
        absolute: Boolean((mapOpts as { absolute?: boolean }).absolute),
        preserveAnnotation: (mapOpts as { annotation?: unknown }).annotation !== false,
      });
      return finalizeMappedCSS(css, mapped.map, options);
    }
    if (owner && handle !== undefined) {
      const effective = await this.resolveStringifyAnnotationLive(asProcessRoot(live), options);
      const wantsMap = Boolean(effective.map);
      if (!wantsMap) return { css: owner.session.stringify(handle) };
      const mapOpts = effective.map && typeof effective.map === 'object' ? effective.map : {};
      const mapped = owner.session.stringifyMap(handle, {
        from: effective.from,
        to: effective.to,
        absolute: Boolean((mapOpts as { absolute?: boolean }).absolute),
        preserveAnnotation: (mapOpts as { annotation?: unknown }).annotation !== false,
      });
      return finalizeMappedCSS(mapped.css, mapped.map, effective);
    }
    assertSupportedAst(live);
    const preparedOptions = prepareStringifyOptions(live, options);
    const effectiveOptions = await this.resolveStringifyAnnotationLive(
      asProcessRoot(live),
      preparedOptions,
    );
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
    this.assertOpen();

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

  /**
   * Annotation callbacks run against the live parse tree. Map composition stays
   * string-in/string-out on Go-owned arenas; Worker DTO trees stringify as before.
   */
  private async processWithAnnotation(
    css: string,
    options: ProcessOptions,
  ): Promise<ProcessResult> {
    const normalized = normalizeProcessOptions(
      options as NormalizeProcessOptionsInput,
      joinMapAnnotationPath,
    ) as ProcessOptions;
    const parsed = await this.parse(css, normalized);
    const live = asProcessRoot(
      parsed.root instanceof Node ? parsed.root : (fromJSONLocal(parsed.root as object) as Node),
    );
    if (isGoOwned(live)) annotateOwnedInput(live, css, options);
    else attachInputMetadata(live, css, options);
    const effective = await this.resolveStringifyAnnotationLive(live, options);
    if (isGoOwned(live) && effective.map) {
      const processed = await this.call<ProcessResult>('process', {
        css,
        options: normalizeProcessOptions(
          effective as NormalizeProcessOptionsInput,
          joinMapAnnotationPath,
        ) as ProcessOptions,
      });
      return {
        ...processed,
        root: live,
        messages: processed.messages ?? [],
        backend: 'wasm-worker',
      };
    }
    const stringified = await this.stringifyResult(live, effective);
    return { ...stringified, root: live, messages: [], backend: 'wasm-worker' };
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
    // DTO-only service API: the caller already serialized its tree, so this is
    // the one browser path that still hydrates. It retires with the DTO surface.
    const live = asProcessRoot(root instanceof Node ? root : internDetached(fromAst(root)));
    const annotation = await options.map.annotation(options.to, live as never);
    return { ...options, map: { ...options.map, annotation } };
  }

  /** Resolve the annotation against a root that is already live. */
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

  private assertOpen(): void {
    if (this.closed) throw new WasmWorkerError('postcss-go WASM service is closed');
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
