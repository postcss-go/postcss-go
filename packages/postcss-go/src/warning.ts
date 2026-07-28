import type { Node } from './ast.js';
import type { SourceInput, SourcePosition } from './types.js';

export interface WarningOptions {
  plugin?: string;
  node?: Node;
  input?: SourceInput;
  source?: string;
  index?: number;
  word?: string;
  start?: SourcePosition;
  end?: SourcePosition;
  [key: string]: unknown;
}

/** A structured plugin warning owned by postcss-go. */
export class Warning {
  type = 'warning' as const;
  text: string;
  plugin?: string;
  node?: Node;
  input?: SourceInput;
  source?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  [key: string]: unknown;

  constructor(text: string, options: WarningOptions = {}) {
    this.text = text;
    this.plugin = options.plugin;
    this.node = options.node;
    this.input = options.node?.source?.input;
    this.source =
      typeof options.node?.source?.input?.css === 'string'
        ? options.node.source.input.css
        : undefined;
    const range = options.node?.rangeBy(options) ?? {
      start: options.start,
      end: options.end,
    };
    if (range.start) {
      this.line = range.start.line;
      this.column = range.start.column;
    }
    if (range.end) {
      this.endLine = range.end.line;
      this.endColumn = range.end.column;
    }
    for (const [name, value] of Object.entries(options)) {
      if (!['plugin', 'node', 'index', 'word', 'start', 'end'].includes(name)) this[name] = value;
    }
  }

  toString(): string {
    const location =
      this.line && this.column
        ? `${this.node?.source?.file ?? '<css input>'}:${this.line}:${this.column}: `
        : '';
    return `${location}${this.plugin ? `${this.plugin}: ` : ''}${this.text}`;
  }
}
