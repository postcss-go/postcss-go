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

export interface RangePosition {
  line: number;
  column: number;
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
    line?: number | RangePosition,
    column?: number | RangePosition,
    source?: string,
    file?: string,
    plugin?: string,
  );
  constructor(
    message: string,
    optionsOrLine: CssSyntaxErrorOptions | number | RangePosition = {},
    column?: number | RangePosition,
    source?: string,
    file?: string,
    plugin?: string,
  ) {
    super(message);
    this.name = 'CssSyntaxError';
    this.reason = message;
    let options: CssSyntaxErrorOptions;
    if (typeof optionsOrLine === 'number') {
      options = {
        line: optionsOrLine,
        column: typeof column === 'number' ? column : undefined,
        source,
        file,
        plugin,
      };
    } else if (isRangePosition(optionsOrLine) && isRangePosition(column)) {
      options = {
        line: optionsOrLine.line,
        column: optionsOrLine.column,
        endLine: column.line,
        endColumn: column.column,
        source,
        file,
        plugin,
      };
    } else {
      options = optionsOrLine;
    }
    Object.assign(this, options);
    this.setMessage();
    if (Error.captureStackTrace) Error.captureStackTrace(this, CssSyntaxError);
  }

  setMessage(): void {
    this.message = this.plugin ? `${this.plugin}: ` : '';
    this.message += this.file ?? '<css input>';
    if (this.line !== undefined) {
      this.message += `:${this.line}:${this.column ?? 1}`;
    }
    this.message += `: ${this.reason}`;
  }

  showSourceCode(color = false): string {
    if (!this.source || this.line === undefined || this.column === undefined) return '';
    const lines = this.source.split(/\r?\n/);
    const start = Math.max(this.line - 3, 0);
    const end = Math.min(this.line + 2, lines.length);
    const width = String(end).length;
    return lines
      .slice(start, end)
      .map((sourceLine, index) => {
        const number = start + index + 1;
        const gutter = ` ${String(number).padStart(width)} | `;
        if (number !== this.line) return ` ${gutter}${sourceLine}`;
        const spacing = `${gutter.replace(/\d/g, ' ')}${sourceLine
          .slice(0, Math.max(0, this.column! - 1))
          .replace(/[^\t]/g, ' ')}`;
        const marker = color ? '\u001B[31;1m^\u001B[0m' : '^';
        return `>${gutter}${sourceLine}\n ${spacing}${marker}`;
      })
      .join('\n');
  }

  override toString(): string {
    const source = this.showSourceCode();
    return `${this.name}: ${this.message}${source ? `\n\n${source}\n` : ''}`;
  }
}

function isRangePosition(value: unknown): value is RangePosition {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as RangePosition).line === 'number' &&
    typeof (value as RangePosition).column === 'number'
  );
}

/** Raised when an explicit synchronous API has no in-process backend. */
export class SyncBackendUnavailableError extends Error {
  constructor(
    message = 'A synchronous postcss-go API requires the Node N-API backend, but no native addon is available; the browser WASM Worker backend is asynchronous only',
  ) {
    super(message);
    this.name = 'SyncBackendUnavailableError';
  }
}

/** Raised when the default Promise API cannot load the required async native backend. */
export class AsyncBackendUnavailableError extends Error {
  constructor() {
    super(
      'The asynchronous postcss-go API requires the worker-backed Node N-API backend, but no compatible native addon is available; reinstall @postcss-go/core for the current platform',
    );
    this.name = 'AsyncBackendUnavailableError';
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
