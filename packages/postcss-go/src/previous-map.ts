import type { PreviousSourceMap, ProcessOptions } from './types.js';
import { serializePreviousMap } from '@postcss-go/shared/map-options';

export interface PreviousMapOptions extends ProcessOptions {
  map?: ProcessOptions['map'];
}

export interface SourceMapPosition {
  source: string | null;
  line: number | null;
  column: number | null;
  name: string | null;
}

export interface SourceMapConsumerLike {
  sources: string[];
  sourcesContent?: (string | null)[];
  sourceRoot?: string;
  originalPositionFor(generated: { line: number; column: number }): SourceMapPosition;
  sourceContentFor(source: string, nullOnMissing?: boolean): string | null;
}

type PreviousMapFileLoader = (file: string) => string | undefined;
let previousMapFileLoader: PreviousMapFileLoader | undefined;

/** Install the synchronous file loader used by the Node.js public entry point. */
export function setPreviousMapFileLoader(loader: PreviousMapFileLoader): void {
  previousMapFileLoader = loader;
}

type RawMap = {
  version?: number;
  file?: string;
  sourceRoot?: string;
  sources?: string[];
  sourcesContent?: (string | null)[];
  names?: string[];
  mappings?: string;
};

/**
 * Lightweight, postcss-go-owned representation of an input source map.
 * Parsing, composition, and annotation emission remain Go responsibilities.
 */
export class PreviousMap {
  annotation?: string;
  file?: string;
  mapFile?: string;
  root?: string;
  text?: string;
  inline = false;
  private consumerCache?: SourceMapConsumerLike;

  constructor(css: string, options: PreviousMapOptions = {}) {
    if (options.map === false) return;
    const matches = [...css.matchAll(/\/\*\s*# sourceMappingURL=(.*?)\*\//gs)];
    this.annotation = matches.at(-1)?.[1]?.trim();
    this.inline = this.annotation?.startsWith('data:') === true;
    const previous = options.map && typeof options.map === 'object' ? options.map.prev : undefined;
    this.text = previousMapText(previous, options.from);
    if (!this.text && this.inline && this.annotation) {
      this.text = decodeInlineMap(this.annotation);
    }
    if (!this.inline && this.annotation) {
      this.mapFile = resolveMapPath(options.from, this.annotation);
      if (!this.text) this.text = loadMapFile(this.mapFile);
    } else if (this.text && options.from) {
      this.mapFile = options.from;
    }
    this.root = this.mapFile ? dirname(this.mapFile) : undefined;
    this.file = options.from;
  }

  consumer(): SourceMapConsumerLike {
    if (!this.text) throw new Error('Previous source map is not available');
    this.consumerCache ??= createConsumer(this.toJSON() as RawMap);
    return this.consumerCache;
  }

  withContent(): boolean {
    try {
      const contents = this.consumer().sourcesContent;
      return Array.isArray(contents) && contents.length > 0;
    } catch {
      return false;
    }
  }

  toJSON(): Record<string, unknown> | undefined {
    if (!this.text) return undefined;
    try {
      return JSON.parse(this.text) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  toString(): string {
    return this.text ?? '';
  }
}

function previousMapText(
  previous: PreviousSourceMap | undefined,
  file?: string,
): string | undefined {
  const value = typeof previous === 'function' ? previous(file) : previous;
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  try {
    return serializePreviousMap(value);
  } catch {
    if (typeof (value as { toString?: unknown }).toString === 'function') {
      const text = String(value);
      if (text !== '[object Object]') return text;
    }
    return JSON.stringify(value);
  }
}

function decodeInlineMap(annotation: string): string | undefined {
  const comma = annotation.indexOf(',');
  if (comma < 0) return undefined;
  const metadata = annotation.slice(0, comma);
  const payload = annotation.slice(comma + 1);
  if (!/^data:application\/json(?:;charset=utf-?8)?(?:;base64)?$/i.test(metadata)) {
    throw new Error(`Unsupported source map encoding ${metadata}`);
  }
  return metadata.includes(';base64') ? decodeBase64(payload) : decodeURIComponent(payload);
}

function decodeBase64(value: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(value, 'base64').toString('utf8');
  if (typeof atob !== 'undefined') return decodeURIComponent(escape(atob(value)));
  throw new Error('Base64 source maps are not supported in this runtime');
}

function dirname(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index < 0 ? '.' : normalized.slice(0, index) || '/';
}

function resolveMapPath(from: string | undefined, annotation: string): string {
  if (/^\w+:\/\//.test(annotation) || isAbsolutePath(annotation)) return annotation;
  if (!from) return annotation;
  return resolvePath(dirname(from), annotation);
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

function resolvePath(base: string, relative: string): string {
  const prefix = base.startsWith('/') ? '/' : '';
  const parts = `${base}/${relative}`.replace(/\\/g, '/').split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  return `${prefix}${resolved.join('/')}`;
}

function loadMapFile(file: string): string | undefined {
  const loaded = previousMapFileLoader?.(file);
  if (!loaded) return undefined;
  const text = loaded.trim().replace(/^\)]}'[^\n]*\n/, '');
  try {
    JSON.parse(text);
    return text;
  } catch {
    return undefined;
  }
}

const VLQ_SHIFT = 5;
const VLQ_CONTINUATION = 1 << VLQ_SHIFT;
const VLQ_MASK = VLQ_CONTINUATION - 1;
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

type Mapping = {
  generatedLine: number;
  generatedColumn: number;
  sourceIndex?: number;
  originalLine?: number;
  originalColumn?: number;
  nameIndex?: number;
};

function createConsumer(raw: RawMap): SourceMapConsumerLike {
  const sources = raw.sources ?? [];
  const sourcesContent = raw.sourcesContent;
  const sourceRoot = raw.sourceRoot;
  const names = raw.names ?? [];
  const mappings = decodeMappings(raw.mappings ?? '');
  return {
    sources,
    sourcesContent,
    sourceRoot,
    originalPositionFor({ line, column }) {
      let match: Mapping | undefined;
      for (const mapping of mappings) {
        if (mapping.generatedLine > line) break;
        if (mapping.generatedLine === line && mapping.generatedColumn > column) break;
        if (mapping.sourceIndex !== undefined) match = mapping;
      }
      if (!match || match.sourceIndex === undefined) {
        return { source: null, line: null, column: null, name: null };
      }
      return {
        source: sources[match.sourceIndex] ?? null,
        line: (match.originalLine ?? 0) + 1,
        column: match.originalColumn ?? 0,
        name: match.nameIndex === undefined ? null : (names[match.nameIndex] ?? null),
      };
    },
    sourceContentFor(source, nullOnMissing = false) {
      const index = sources.indexOf(source);
      if (index < 0) {
        if (nullOnMissing) return null;
        throw new Error(`source ${source} is not in the source map`);
      }
      return sourcesContent?.[index] ?? null;
    },
  };
}

function decodeMappings(input: string): Mapping[] {
  const mappings: Mapping[] = [];
  let generatedLine = 1;
  let generatedColumn = 0;
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let nameIndex = 0;
  let offset = 0;
  const next = (): number => {
    const decoded = decodeVlq(input, offset);
    offset = decoded.next;
    return decoded.value;
  };
  const atSeparator = (): boolean => {
    if (offset >= input.length) return true;
    const ch = input.charCodeAt(offset);
    return ch === 59 || ch === 44;
  };
  while (offset < input.length) {
    const ch = input.charCodeAt(offset);
    if (ch === 59 /* ; */) {
      generatedLine += 1;
      generatedColumn = 0;
      offset += 1;
      continue;
    }
    if (ch === 44 /* , */) {
      offset += 1;
      continue;
    }
    generatedColumn += next();
    const mapping: Mapping = { generatedLine, generatedColumn };
    if (!atSeparator()) {
      sourceIndex += next();
      originalLine += next();
      originalColumn += next();
      mapping.sourceIndex = sourceIndex;
      mapping.originalLine = originalLine;
      mapping.originalColumn = originalColumn;
      if (!atSeparator()) {
        nameIndex += next();
        mapping.nameIndex = nameIndex;
      }
    }
    mappings.push(mapping);
  }
  return mappings;
}

function decodeVlq(input: string, start: number): { value: number; next: number } {
  let result = 0;
  let shift = 0;
  let offset = start;
  while (offset < input.length) {
    const digit = BASE64.indexOf(input[offset] ?? '');
    offset += 1;
    if (digit < 0) break;
    result += (digit & VLQ_MASK) << shift;
    if ((digit & VLQ_CONTINUATION) === 0) {
      return { value: result & 1 ? -(result >> 1) : result >> 1, next: offset };
    }
    shift += VLQ_SHIFT;
  }
  return { value: result & 1 ? -(result >> 1) : result >> 1, next: offset };
}
