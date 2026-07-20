import type { PostcssGoService } from './service.js';
import type { AstNode, ParseResult, ProcessOptions, ProcessResult } from './types.js';

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
    return this.call<ParseResult>('parse', { css, options });
  }

  async process(css: string, options: ProcessOptions = {}): Promise<ProcessResult> {
    return this.call<ProcessResult>('process', { css, options });
  }

  async stringify(ast: AstNode): Promise<string> {
    const result = await this.call<{ css: string }>('stringify', { ast });
    if (typeof result?.css !== 'string') {
      throw new Error('postcss-go WASM stringify response is missing css');
    }
    return result.css;
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
