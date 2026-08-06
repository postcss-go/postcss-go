import {
  materializePreviousMap,
  normalizeProcessOptions,
  type NormalizeProcessOptionsInput,
} from '@postcss-go/shared/map-options';
import { joinMapAnnotationPath } from '@postcss-go/shared/map-path';
import { WASM_WORKER_BACKEND_CAPABILITIES, type PostcssGoService } from './service.js';
import { asProcessRoot, fromAst } from './ast.js';
import { assertSupportedAst } from './codec.js';
import { attachInputMetadata } from './input.js';
import type {
  AstNode,
  AstStringifyResult,
  NoWorkResult,
  ParseResult,
  ProcessOptions,
  ProcessResult,
} from './types.js';
import { prepareStringifyOptions } from './source-map-output.js';

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
}

export class BrowserPostcssGoService implements PostcssGoService {
  readonly capabilities = WASM_WORKER_BACKEND_CAPABILITIES;
  readonly workerUrl?: string;
  readonly wasmUrl?: string;
  readonly wasmExecUrl?: string;

  private readonly worker: BrowserWorkerLike;
  private readonly pending = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >();
  private nextId = 1;
  private closed = false;

  constructor(options: BrowserPostcssGoServiceOptions = {}) {
    this.workerUrl = options.workerUrl;
    this.wasmUrl = options.wasmUrl;
    this.wasmExecUrl = options.wasmExecUrl;
    this.worker = options.worker ?? createWorker(options.workerUrl);
    this.worker.onmessage = (event) => this.handleMessage(event.data);
    this.worker.onerror = (event) => {
      const message =
        event.error instanceof Error ? event.error.message : event.message || 'WASM worker failed';
      this.rejectAll(new Error(message));
    };

    if (!options.worker) {
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
    const effectiveOptions = this.resolveAnnotation(css, options);
    if (effectiveOptions instanceof Promise) {
      return effectiveOptions.then(async (resolved) => ({
        ...(await this.call<ProcessResult>('process', {
          css,
          options: normalizeProcessOptions(
            resolved as NormalizeProcessOptionsInput,
            joinMapAnnotationPath,
          ) as ProcessOptions,
        })),
        backend: 'wasm-worker',
      }));
    }
    return this.call<ProcessResult>('process', {
      css,
      options: normalizeProcessOptions(
        effectiveOptions as NormalizeProcessOptionsInput,
        joinMapAnnotationPath,
      ) as ProcessOptions,
    }).then((result) => ({ ...result, backend: 'wasm-worker' }));
  }

  noWork(css: string, options: ProcessOptions = {}): Promise<NoWorkResult> {
    options = materializePreviousMap(options);
    const effectiveOptions = this.resolveAnnotation(css, options);
    if (effectiveOptions instanceof Promise) {
      return effectiveOptions.then((resolved) =>
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
        effectiveOptions as NormalizeProcessOptionsInput,
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
      throw new Error('postcss-go WASM stringify response is missing css');
    }
    return result;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.rejectAll(new Error('postcss-go WASM service closed'));
    this.worker.terminate();
  }

  private call<T>(method: string, params: unknown): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error('postcss-go WASM service is closed'));
    }

    const id = this.nextId++;
    const pending = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (result: unknown) => void, reject });
    });
    try {
      this.worker.postMessage({ id, method, params });
    } catch (error) {
      this.pending.delete(id);
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return pending;
  }

  private resolveAnnotation(
    css: string,
    options: ProcessOptions,
  ): ProcessOptions | Promise<ProcessOptions> {
    if (
      !options.map ||
      typeof options.map !== 'object' ||
      typeof options.map.annotation !== 'function'
    ) {
      return options;
    }
    const map = options.map;
    const annotationCallback = map.annotation as (
      file: string | undefined,
      root: ReturnType<typeof asProcessRoot>,
    ) => string | Promise<string>;
    return this.parse(css, { from: options.from }).then(async (parsed) => {
      const root = asProcessRoot(fromAst(parsed.root));
      attachInputMetadata(root, css, options);
      return {
        ...options,
        map: {
          ...map,
          annotation: await annotationCallback(options.to, root),
        },
      };
    });
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

  private handleMessage(message: unknown): void {
    if (!message || typeof message !== 'object') return;
    const response = message as {
      id?: unknown;
      result?: unknown;
      error?: { message?: string; name?: string };
    };
    if (typeof response.id !== 'number') return;

    const request = this.pending.get(response.id);
    if (!request) return;
    this.pending.delete(response.id);

    if (response.error) {
      const error = new Error(response.error.message || 'postcss-go WASM request failed');
      if (response.error.name) error.name = response.error.name;
      request.reject(error);
      return;
    }
    request.resolve(response.result);
  }

  private rejectAll(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}

function createWorker(workerUrl?: string): BrowserWorkerLike {
  if (!workerUrl || typeof Worker === 'undefined') {
    throw new Error('A Worker-compatible runtime and workerUrl are required for browser service');
  }
  return new Worker(workerUrl) as unknown as BrowserWorkerLike;
}
