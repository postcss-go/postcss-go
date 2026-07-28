import type { PreviousSourceMap, ProcessOptions } from './types.js';

export interface PreviousMapOptions extends ProcessOptions {
  map?: ProcessOptions['map'];
}

/**
 * Lightweight, postcss-go-owned representation of an input source map.
 * Parsing, composition, and annotation emission remain Go responsibilities.
 */
export class PreviousMap {
  annotation?: string;
  file?: string;
  root?: string;
  text?: string;
  inline = false;

  constructor(css: string, options: PreviousMapOptions = {}) {
    this.file = options.from;
    const matches = [...css.matchAll(/\/\*\s*# sourceMappingURL=(.*?)\*\//gs)];
    this.annotation = matches.at(-1)?.[1]?.trim();
    this.inline = this.annotation?.startsWith('data:') === true;
    const previous = options.map && typeof options.map === 'object' ? options.map.prev : undefined;
    this.text = previousMapText(previous, options.from);
    if (!this.text && this.inline && this.annotation) {
      this.text = decodeInlineMap(this.annotation);
    }
  }

  withContent(): boolean {
    if (!this.text) return false;
    try {
      const map = JSON.parse(this.text) as { sourcesContent?: unknown };
      return Array.isArray(map.sourcesContent);
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
  try {
    return metadata.includes(';base64')
      ? Buffer.from(payload, 'base64').toString('utf8')
      : decodeURIComponent(payload);
  } catch {
    return undefined;
  }
}
