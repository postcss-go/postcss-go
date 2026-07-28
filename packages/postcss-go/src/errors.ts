import type { SourceInput, SourcePosition } from './types.js';

export interface CssSyntaxErrorOptions {
  file?: string;
  source?: string;
  plugin?: string;
  input?: SourceInput;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

/** A PostCSS-compatible syntax error owned by postcss-go. */
export class CssSyntaxError extends Error {
  reason: string;
  file?: string;
  source?: string;
  plugin?: string;
  input?: SourceInput;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  postcssNode?: unknown;

  constructor(message: string, options?: CssSyntaxErrorOptions);
  constructor(
    message: string,
    line?: number,
    column?: number,
    source?: string,
    file?: string,
    plugin?: string,
  );
  constructor(
    message: string,
    optionsOrLine: CssSyntaxErrorOptions | number = {},
    column?: number,
    source?: string,
    file?: string,
    plugin?: string,
  ) {
    super(message);
    this.name = 'CssSyntaxError';
    this.reason = message;
    const options =
      typeof optionsOrLine === 'number'
        ? { line: optionsOrLine, column, source, file, plugin }
        : optionsOrLine;
    Object.assign(this, options);
  }

  showSourceCode(color = false): string {
    if (!this.source || !this.line || !this.column) return '';
    const lines = this.source.split(/\r?\n/);
    const sourceLine = lines[this.line - 1] ?? '';
    const markerLength =
      this.endLine === this.line && this.endColumn ? Math.max(1, this.endColumn - this.column) : 1;
    const marker = `${' '.repeat(Math.max(0, this.column - 1))}${'^'.repeat(markerLength)}`;
    if (!color) return `${sourceLine}\n${marker}`;
    return `${sourceLine}\n\u001B[31;1m${marker}\u001B[0m`;
  }

  override toString(): string {
    const location =
      this.line && this.column
        ? `${this.file ?? '<css input>'}:${this.line}:${this.column}: `
        : this.file
          ? `${this.file}: `
          : '';
    const plugin = this.plugin ? `${this.plugin}: ` : '';
    const source = this.showSourceCode();
    return `${location}${plugin}${this.reason}${source ? `\n\n${source}` : ''}`;
  }
}

/** Raised when an explicit synchronous API has no in-process backend. */
export class SyncBackendUnavailableError extends Error {
  constructor() {
    super(
      'A synchronous postcss-go API requires the Node N-API backend, but no native addon is available',
    );
    this.name = 'SyncBackendUnavailableError';
  }
}

/** Raised when a callback returns a Promise during explicit synchronous processing. */
export class AsyncPluginError extends Error {
  constructor(extensionPoint: string, plugin?: string) {
    super(
      `${plugin ? `${plugin}: ` : ''}${extensionPoint} returned a Promise during synchronous postcss-go execution; use an asynchronous API instead`,
    );
    this.name = 'AsyncPluginError';
  }
}

/** Raised for custom syntax values that cannot safely cross a Go backend boundary. */
export class UnsupportedSyntaxError extends Error {
  constructor(feature = 'Custom parser, syntax, and stringifier options') {
    super(`${feature} are not supported by the postcss-go bridge`);
    this.name = 'UnsupportedSyntaxError';
  }
}

/** Raised before a custom AST node is silently lost at a native or WASM boundary. */
export class UnsupportedAstNodeError extends Error {
  constructor(type: string) {
    super(
      `Custom AST node type "${type}" cannot cross this postcss-go backend boundary; provide a JavaScript stringifier or remove the custom node`,
    );
    this.name = 'UnsupportedAstNodeError';
  }
}

export function positionAt(source: string, offset: number): SourcePosition {
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset; index++) {
    if (source.charCodeAt(index) === 10) {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column, offset };
}

export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/** Mark a rejected thenable as observed before a synchronous API rejects it. */
export function observeThenable(value: PromiseLike<unknown>): void {
  void Promise.resolve(value).catch(() => undefined);
}
