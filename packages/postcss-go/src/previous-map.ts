import type { PreviousSourceMap, ProcessOptions } from './types.js';
import { SourceMapConsumer, SourceMapGenerator, type RawSourceMap } from 'source-map-js';

export interface PreviousMapOptions extends ProcessOptions {
  map?: ProcessOptions['map'];
}

type PreviousMapFileLoader = (file: string) => string | undefined;
let previousMapFileLoader: PreviousMapFileLoader | undefined;

/** Install the synchronous file loader used by the Node.js public entry point. */
export function setPreviousMapFileLoader(loader: PreviousMapFileLoader): void {
  previousMapFileLoader = loader;
}

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
  private consumerCache?: SourceMapConsumer;

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

  consumer(): SourceMapConsumer {
    if (!this.text) throw new Error('Previous source map is not available');
    this.consumerCache ??= new SourceMapConsumer(this.toJSON() as unknown as RawSourceMap);
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
  if (value instanceof SourceMapConsumer) {
    return SourceMapGenerator.fromSourceMap(value).toString();
  }
  if (value instanceof SourceMapGenerator) return value.toString();
  if (typeof (value as { toString?: unknown }).toString === 'function') {
    const text = String(value);
    if (text !== '[object Object]') return text;
  }
  return JSON.stringify(value);
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
