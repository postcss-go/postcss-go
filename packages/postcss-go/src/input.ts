import { CssSyntaxError, positionAt, type RangePosition } from './errors.js';
import type { Node } from './ast.js';
import { PreviousMap } from './previous-map.js';
import type { ProcessOptions } from './types.js';

export interface InputJSON {
  css?: string;
  document?: string;
  file?: string;
  hasBOM?: boolean;
  id?: string;
  map?: PreviousMap | Record<string, unknown>;
  [property: string]: unknown;
}

export interface InputFilePosition {
  line: number;
  column: number;
  offset: number;
  endLine?: number;
  endColumn?: number;
  endOffset?: number;
  file?: string;
  source?: string;
  url: string;
}

type InputErrorPoint = number | RangePosition | { offset: number };

/** The PostCSS-compatible `source.input` object. */
export class Input {
  css: string;
  document: string;
  hasBOM: boolean;
  file?: string;
  id?: string;
  map?: PreviousMap;
  [property: string]: unknown;

  private lineToIndex?: number[];

  constructor(cssInput: string | { toString(): string }, options: ProcessOptions = {}) {
    if (
      cssInput === null ||
      cssInput === undefined ||
      (typeof cssInput === 'object' && typeof cssInput.toString !== 'function')
    ) {
      throw new Error(`postcss-go received ${String(cssInput)} instead of a CSS string`);
    }
    this.css = String(cssInput);
    if (this.css[0] === '\uFEFF' || this.css[0] === '\uFFFE') {
      this.hasBOM = true;
      this.css = this.css.slice(1);
    } else {
      this.hasBOM = false;
    }
    this.document = String(options.document ?? this.css);
    if (options.from) this.file = resolveInputPath(options.from);
    if (!this.file) this.id = nextInputId();
    if (hasPreviousMap(this.css, options)) {
      const map = new PreviousMap(this.css, { ...options, from: this.file ?? options.from });
      if (map.text) {
        this.map = map;
        this.map.file = this.from;
      }
    }
  }

  get from(): string {
    return this.file ?? this.id!;
  }

  error(
    message: string,
    start: RangePosition | { offset: number },
    end: RangePosition | { offset: number },
    options?: { plugin?: string },
  ): CssSyntaxError;
  error(
    message: string,
    line: number,
    column: number,
    options?: { plugin?: string },
  ): CssSyntaxError;
  error(message: string, offset: number, options?: { plugin?: string }): CssSyntaxError;
  error(
    message: string,
    start: InputErrorPoint,
    columnOrEndOrOptions?: number | RangePosition | { offset: number } | { plugin?: string },
    maybeOptions: { plugin?: string } = {},
  ): CssSyntaxError {
    let startOffset: number;
    let line: number;
    let column: number;
    let endOffset: number | undefined;
    let endLine: number | undefined;
    let endColumn: number | undefined;
    let options = maybeOptions;

    if (typeof start === 'object') {
      const startPosition = normalizePoint(this, start);
      startOffset = startPosition.offset;
      line = startPosition.line;
      column = startPosition.column;
      const end = columnOrEndOrOptions as RangePosition | { offset: number };
      const endPosition = normalizePoint(this, end);
      endOffset = endPosition.offset;
      endLine = endPosition.line;
      endColumn = endPosition.column;
    } else if (typeof columnOrEndOrOptions === 'number') {
      line = start;
      column = columnOrEndOrOptions;
      startOffset = this.fromLineAndColumn(line, column);
    } else {
      startOffset = start;
      const position = this.fromOffset(startOffset);
      if (!position) throw new Error(`Invalid CSS offset ${startOffset}`);
      line = position.line;
      column = position.col;
      options = (columnOrEndOrOptions as { plugin?: string } | undefined) ?? {};
    }

    const origin = this.origin(line, column, endLine, endColumn);
    const error = origin
      ? new CssSyntaxError(
          message,
          endLine === undefined ? origin.line : { line: origin.line, column: origin.column },
          endLine === undefined
            ? origin.column
            : { line: origin.endLine!, column: origin.endColumn! },
          origin.source,
          origin.file,
          options.plugin,
        )
      : new CssSyntaxError(
          message,
          endLine === undefined ? line : { line, column },
          endLine === undefined ? column : { line: endLine, column: endColumn! },
          this.css,
          this.file,
          options.plugin,
        );
    error.input = {
      line,
      column,
      offset: startOffset,
      endLine,
      endColumn,
      endOffset,
      source: this.css,
      ...(this.file ? { file: this.file, url: pathToUrl(this.file) } : {}),
    };
    return error;
  }

  fromLineAndColumn(line: number, column: number): number {
    this.lineToIndex ??= buildLineIndex(this.css);
    return (this.lineToIndex[line - 1] ?? 0) + column - 1;
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

  mapResolve(file: string): string {
    if (/^\w+:\/\//.test(file)) return file;
    const root = this.map?.consumer().sourceRoot ?? this.map?.root ?? '.';
    return resolvePath(root || '.', file);
  }

  origin(
    line: number,
    column: number,
    endLine?: number,
    endColumn?: number,
  ): false | InputFilePosition {
    if (!this.map) return false;
    const consumer = this.map.consumer();
    const from = consumer.originalPositionFor({ line, column });
    if (!from.source || from.line == null || from.column == null) return false;
    const to =
      endLine === undefined
        ? undefined
        : consumer.originalPositionFor({ line: endLine, column: endColumn ?? 0 });
    const resolved = resolveOriginalSource(this.map, from.source);
    const source = consumer.sourceContentFor(from.source, true) ?? undefined;
    return {
      line: from.line,
      column: from.column,
      offset: source ? offsetAt(source, from.line, from.column) : 0,
      endLine: to?.line ?? undefined,
      endColumn: to?.column ?? undefined,
      file: resolved.file,
      url: resolved.url,
      source,
    };
  }

  toJSON(): Record<string, unknown> {
    const json: Record<string, unknown> = {};
    for (const name of ['hasBOM', 'css', 'document', 'file', 'id'] as const) {
      if (this[name] != null) json[name] = this[name];
    }
    if (this.map) {
      const map = { ...this.map } as Record<string, unknown>;
      delete map.consumerCache;
      json.map = map;
    }
    return json;
  }
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
  const hydrated = { ...(value as Record<string, unknown>) };
  if (hydrated.map && typeof hydrated.map === 'object') {
    hydrated.map = Object.setPrototypeOf({ ...(hydrated.map as object) }, PreviousMap.prototype);
  }
  return Object.setPrototypeOf(hydrated, Input.prototype) as Input;
}

/** Attach one shared owned Input instance to every source-bearing live node. */
export function attachInput(root: Node, css: string, options: ProcessOptions = {}): Input {
  const file = options.from;
  const input = new Input(css, options);
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
export function attachPreviousMap(input: Input, css: string, options: ProcessOptions = {}): Input {
  if (!hasPreviousMap(css, options)) {
    delete input.map;
  } else if (!input.map) {
    const map = new PreviousMap(css, options);
    if (map.text) input.map = map;
  }
  return input;
}

/** Attach one Input, including previous-map metadata, to a live AST. */
export function attachInputMetadata(root: Node, css: string, options: ProcessOptions = {}): Input {
  return attachPreviousMap(attachInput(root, css, options), css, options);
}

let inputSequence = 0;

function nextInputId(): string {
  inputSequence += 1;
  return `<input css ${inputSequence}>`;
}

function normalizePoint(
  input: Input,
  point: RangePosition | { offset: number },
): { line: number; column: number; offset: number } {
  if ('offset' in point) {
    const position = input.fromOffset(point.offset);
    if (!position) throw new Error(`Invalid CSS offset ${point.offset}`);
    return { line: position.line, column: position.col, offset: point.offset };
  }
  return {
    line: point.line,
    column: point.column,
    offset: input.fromLineAndColumn(point.line, point.column),
  };
}

function resolveInputPath(value: string): string {
  if (/^\w+:\/\//.test(value) || isAbsolutePath(value)) return value;
  const cwd =
    typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : '.';
  return resolvePath(cwd, value);
}

function resolvePath(base: string, relative: string): string {
  if (/^\w+:\/\//.test(base)) return new URL(relative, ensureTrailingSlash(base)).toString();
  if (isAbsolutePath(relative)) return relative;
  const normalizedBase = base.replace(/\\/g, '/');
  const drive = normalizedBase.match(/^[A-Za-z]:/)?.[0] ?? '';
  const absolute = normalizedBase.startsWith('/') || drive !== '';
  const withoutDrive = drive ? normalizedBase.slice(drive.length) : normalizedBase;
  const parts = `${withoutDrive}/${relative}`.replace(/\\/g, '/').split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  return `${drive}${absolute && !drive ? '/' : drive ? '/' : ''}${resolved.join('/')}`;
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function pathToUrl(file: string): string {
  if (/^\w+:\/\//.test(file)) return file;
  const normalized = file.replace(/\\/g, '/');
  const prefix = normalized.startsWith('/') ? 'file://' : 'file:///';
  return new URL(`${prefix}${normalized}`).toString();
}

function resolveOriginalSource(map: PreviousMap, source: string): { file?: string; url: string } {
  if (/^\w+:\/\//.test(source)) {
    const url = new URL(source).toString();
    return { ...(url.startsWith('file:') ? { file: fileUrlToPath(url) } : {}), url };
  }
  const base = map.consumer().sourceRoot ?? map.root ?? dirname(map.mapFile ?? map.file ?? '.');
  const file = resolvePath(base || '.', source);
  return { file, url: pathToUrl(file) };
}

function dirname(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index < 0 ? '.' : normalized.slice(0, index) || '/';
}

function fileUrlToPath(value: string): string {
  const url = new URL(value);
  return decodeURIComponent(url.pathname);
}

function offsetAt(source: string, line: number, column: number): number {
  const lines = source.split('\n');
  let offset = 0;
  for (let index = 0; index < line - 1; index++) offset += (lines[index]?.length ?? 0) + 1;
  return offset + column;
}
