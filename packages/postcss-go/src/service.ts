import type {
  AstNode,
  AstStringifyResult,
  NoWorkResult,
  ParseResult,
  ProcessOptions,
  ProcessResult,
} from './types.js';
import type { Node, Root } from './ast.js';

export type BackendKind = 'native' | 'wasm-worker';

interface BaseBackendCapabilities {
  readonly backend: BackendKind;
  readonly asynchronous: true;
  /** Backend compute for Promise operations executes outside the host main thread. */
  readonly backendWorkOffMainThread: true;
}

export interface AsyncOnlyBackendCapabilities extends BaseBackendCapabilities {
  readonly synchronous: false;
}

export interface SynchronousBackendCapabilities extends BaseBackendCapabilities {
  readonly synchronous: true;
}

export type BackendCapabilities = AsyncOnlyBackendCapabilities | SynchronousBackendCapabilities;

export const NATIVE_BACKEND_CAPABILITIES = Object.freeze({
  backend: 'native',
  asynchronous: true,
  backendWorkOffMainThread: true,
  synchronous: true,
} satisfies SynchronousBackendCapabilities);

export const WASM_WORKER_BACKEND_CAPABILITIES = Object.freeze({
  backend: 'wasm-worker',
  asynchronous: true,
  backendWorkOffMainThread: true,
  synchronous: false,
} satisfies AsyncOnlyBackendCapabilities);

/**
 * Backend-independent contract implemented by native Node and browser/WASM
 * services. Implementations own their resources and must be closed by callers.
 */
export interface PostcssGoService {
  /** Stable execution capabilities for this transport. */
  readonly capabilities: BackendCapabilities;
  /** Parse CSS into a serializable Go AST. */
  parse(css: string, options?: ProcessOptions): Promise<ParseResult>;
  /** Process CSS through the Go parser/stringifier pipeline. */
  process(css: string, options?: ProcessOptions): Promise<ProcessResult>;
  /** Apply no-plugin source-map behavior without parsing or stringifying CSS. */
  noWork(css: string, options?: ProcessOptions): Promise<NoWorkResult>;
  /** Stringify a serializable AST with the Go stringifier. */
  stringify(ast: AstNode): Promise<string>;
  /** Stringify an AST and optionally generate a source map entirely in Go. */
  stringifyResult(ast: AstNode, options?: ProcessOptions): Promise<AstStringifyResult>;
  /** Release resources owned by the backend. */
  close(): Promise<void>;
}

/** Service contract exposed after synchronous capability narrowing. */
export interface SyncPostcssGoService extends PostcssGoService {
  readonly capabilities: SynchronousBackendCapabilities;
  parseSync(css: string, options?: ProcessOptions): { root: AstNode | Root };
  processSync(css: string, options?: ProcessOptions): ProcessResult;
  noWorkSync(css: string, options?: ProcessOptions): NoWorkResult;
  stringifySync(ast: AstNode | Node, options?: ProcessOptions): string;
  stringifyResultSync(ast: AstNode | Node, options?: ProcessOptions): AstStringifyResult;
}

/** Narrow a generic service after validating both its capability and methods. */
export function isSyncPostcssGoService(service: PostcssGoService): service is SyncPostcssGoService {
  const candidate = service as PostcssGoService & Partial<SyncPostcssGoService>;
  return (
    service.capabilities.synchronous === true &&
    typeof candidate.parseSync === 'function' &&
    typeof candidate.processSync === 'function' &&
    typeof candidate.noWorkSync === 'function' &&
    typeof candidate.stringifySync === 'function' &&
    typeof candidate.stringifyResultSync === 'function'
  );
}

/** Error used when a service operation is unavailable in the current runtime. */
export class UnsupportedServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedServiceError';
  }
}
