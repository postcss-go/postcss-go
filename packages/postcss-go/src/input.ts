import { CssSyntaxError, positionAt } from './errors.js';
import type { Node } from './ast.js';
import { PreviousMap } from './previous-map.js';
import type { ProcessOptions } from './types.js';

export interface InputJSON {
  css?: string;
  file?: string;
  hasBOM?: boolean;
  id?: string;
  map?: PreviousMap | Record<string, unknown>;
  [property: string]: unknown;
}

/**
 * The PostCSS-compatible `source.input` object. Only the serializable surface is implemented here;
 * `error()` and `origin()` arrive with the error/warning parity work.
 */
export class Input {
  css = '';
  hasBOM = false;
  file?: string;
  id?: string;
  map?: PreviousMap | Record<string, unknown>;
  [property: string]: unknown;

  private lineToIndex?: number[];

  get from(): string {
    return this.file ?? this.id ?? '';
  }

  error(
    message: string,
    line: number,
    column: number,
    options: {
      plugin?: string;
      endLine?: number;
      endColumn?: number;
    } = {},
  ): CssSyntaxError {
    return createInputError(this, message, line, column, options);
  }

  fromOffset(offset: number): { col: number; line: number } | null {
    if (offset < 0) return null;
    this.lineToIndex ??= buildLineIndex(this.css ?? '');
    const index = this.lineToIndex;
    let min = 0;
    let max = index.length - 1;
    while (min < max) {
      const mid = min + ((max - min + 1) >> 1);
      if (index[mid] > offset) max = mid - 1;
      else min = mid;
    }
    return { col: offset - index[min] + 1, line: min + 1 };
  }

  toJSON(): Record<string, unknown> {
    const json: Record<string, unknown> = {};
    for (const name of ['hasBOM', 'css', 'file', 'id'] as const) {
      if (this[name] != null) json[name] = this[name];
    }
    if (this.map) json.map = { ...this.map };
    return json;
  }
}

function createInputError(
  input: Input,
  message: string,
  line: number,
  column: number,
  options: { plugin?: string; endLine?: number; endColumn?: number },
): CssSyntaxError {
  return new CssSyntaxError(message, {
    file: input.file,
    input,
    source: input.css,
    line,
    column,
    ...options,
  });
}

function buildLineIndex(css: string): number[] {
  const lines = css.split('\n');
  const index = new Array<number>(lines.length);
  let offset = 0;
  for (let line = 0; line < lines.length; line++) {
    index[line] = offset;
    offset += lines[line].length + 1;
  }
  return index;
}

/**
 * Reattach the `Input` prototype to a plain object produced by `Input#toJSON()`. Own properties are
 * copied before the prototype is swapped in, so serialized keys such as `from` shadow the accessor
 * of the same name instead of failing to assign.
 */
export function hydrateInput(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if (value instanceof Input) return value;
  return Object.setPrototypeOf({ ...(value as Record<string, unknown>) }, Input.prototype) as Input;
}

/** Attach one shared owned Input instance to every source-bearing live node. */
export function attachInput(root: Node, css: string, file?: string): Input {
  const input = new Input();
  input.css = css;
  input.file = file;
  if (!root.source) {
    root.source = {
      start: { line: 1, column: 1, offset: 0 },
      end: positionAt(css, css.length),
      ...(file ? { file } : {}),
    };
  }
  const visit = (node: Node): void => {
    if (node.source) {
      node.source.input = input;
      if (file && !node.source.file) node.source.file = file;
    }
    const children = (node as Node & { nodes?: Node[] }).nodes;
    for (const child of children ?? []) visit(child);
  };
  visit(root);
  return input;
}

export function hasPreviousMap(css: string, options: ProcessOptions = {}): boolean {
  const map = options.map;
  if (map === false) return false;
  if (map && typeof map === 'object' && map.prev !== undefined) {
    return map.prev !== false;
  }
  return /\/\*\s*# sourceMappingURL=/.test(css);
}

/** Attach PostCSS-compatible previous-map metadata to an owned Input. */
export function attachPreviousMap(
  input: Input,
  css: string,
  options: ProcessOptions = {},
): Input {
  if (hasPreviousMap(css, options)) input.map = new PreviousMap(css, options);
  return input;
}

/** Attach one Input, including previous-map metadata, to a live AST. */
export function attachInputMetadata(
  root: Node,
  css: string,
  options: ProcessOptions = {},
): Input {
  return attachPreviousMap(attachInput(root, css, options.from), css, options);
}
