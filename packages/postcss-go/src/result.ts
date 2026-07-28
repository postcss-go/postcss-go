import type { ProcessRoot } from './ast.js';
import type { ProcessFileOptions } from '@postcss-go/shared/map-options';
import { Warning, type WarningOptions } from './warning.js';
import type { SourceMap } from './types.js';

export interface ResultProcessor {
  plugins: unknown[];
}

/** PostCSS-shaped wrapper around the source-map JSON emitted by Go. */
export class ResultMap implements SourceMap {
  constructor(private readonly text: string) {}

  toJSON(): Record<string, unknown> {
    try {
      return JSON.parse(this.text) as Record<string, unknown>;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`postcss-go result map is not valid JSON: ${detail}`);
    }
  }

  toString(): string {
    return this.text;
  }
}

export function hydrateResultMap(value: string | undefined): ResultMap | undefined {
  return value === undefined ? undefined : new ResultMap(value);
}

/** Mutable processing result shared with plugin callbacks. */
export class Result<P = unknown> {
  css = '';
  map?: ResultMap;
  root: ProcessRoot;
  messages: Array<Record<string, unknown>> = [];
  opts: ProcessFileOptions;
  processor: ResultProcessor;
  lastPlugin?: P;

  constructor(processor: ResultProcessor, root: ProcessRoot, opts: ProcessFileOptions = {}) {
    this.processor = processor;
    this.root = root;
    this.opts = opts;
  }

  get content(): string {
    return this.css;
  }

  warnings(): Warning[] {
    return this.messages.filter((message) => message.type === 'warning') as Warning[];
  }

  warn(text: string, options: WarningOptions = {}): Warning {
    const plugin =
      options.plugin ??
      (typeof this.lastPlugin === 'object' && this.lastPlugin
        ? (this.lastPlugin as { postcssPlugin?: string }).postcssPlugin
        : undefined);
    const warning = new Warning(text, { ...options, plugin });
    this.messages.push(warning);
    return warning;
  }

  toString(): string {
    return this.css;
  }
}
