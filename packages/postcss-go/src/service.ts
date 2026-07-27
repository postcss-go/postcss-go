import type {
  AstNode,
  AstStringifyResult,
  NoWorkResult,
  ParseResult,
  ProcessOptions,
  ProcessResult,
} from './types.js';

/**
 * Transport-independent contract implemented by the Node and browser/WASM
 * services. Implementations own their resources and must be closed by callers
 * when they are no longer needed.
 */
export interface PostcssGoService {
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
  /** Release the underlying worker or bridge process. */
  close(): Promise<void>;
}

/** Error used when a service operation is unavailable in the current runtime. */
export class UnsupportedServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedServiceError';
  }
}
