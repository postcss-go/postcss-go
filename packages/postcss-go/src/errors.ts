import type { SourcePosition } from './types.js';

export interface CssSyntaxErrorOptions {
  file?: string;
  source?: string;
  plugin?: string;
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
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  postcssNode?: unknown;

  constructor(message: string, options: CssSyntaxErrorOptions = {}) {
    super(message);
    this.name = 'CssSyntaxError';
    this.reason = message;
    Object.assign(this, options);
  }

  showSourceCode(color = false): string {
    if (!this.source || !this.line || !this.column) return '';
    const lines = this.source.split(/\r?\n/);
    const sourceLine = lines[this.line - 1] ?? '';
    const markerLength =
      this.endLine === this.line && this.endColumn
        ? Math.max(1, this.endColumn - this.column)
        : 1;
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

