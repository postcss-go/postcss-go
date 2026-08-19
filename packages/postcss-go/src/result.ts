import type { ProcessRoot } from './ast.js';
import type { ProcessFileOptions } from '@postcss-go/shared/map-options';
import { Warning, type WarningOptions } from './warning.js';
import type { ResultMessage, SourceMap } from './types.js';
import type { BackendKind } from './service.js';
import {
  SourceMapConsumer,
  SourceMapGenerator,
  type Mapping,
  type RawSourceMap,
} from 'source-map-js';

export interface ResultProcessor {
  plugins: unknown[];
  version?: string;
}

/** PostCSS-shaped wrapper around the source-map JSON emitted by Go. */
export class ResultMap implements SourceMap {
  private generator?: SourceMapGenerator;

  constructor(private readonly text: string) {}

  toJSON(): Record<string, unknown> {
    if (this.generator) return this.generator.toJSON() as unknown as Record<string, unknown>;
    try {
      return JSON.parse(this.text) as Record<string, unknown>;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`postcss-go result map is not valid JSON: ${detail}`, { cause: error });
    }
  }

  toString(): string {
    return this.generator?.toString() ?? this.text;
  }

  addMapping(mapping: Mapping): void {
    this.getGenerator().addMapping(mapping);
  }

  setSourceContent(sourceFile: string, sourceContent: string | null | undefined): void {
    this.getGenerator().setSourceContent(sourceFile, sourceContent);
  }

  applySourceMap(consumer: SourceMapConsumer, sourceFile?: string, sourceMapPath?: string): void {
    this.getGenerator().applySourceMap(consumer, sourceFile, sourceMapPath);
  }

  private getGenerator(): SourceMapGenerator {
    if (!this.generator) {
      const consumer = new SourceMapConsumer(this.toJSON() as unknown as RawSourceMap);
      this.generator = SourceMapGenerator.fromSourceMap(consumer);
    }
    return this.generator;
  }
}

export function hydrateResultMap(value: string | undefined): ResultMap | undefined {
  return value === undefined ? undefined : new ResultMap(value);
}

export function hydrateResultMessages(messages: ResultMessage[]): ResultMessage[] {
  return messages.map((message) => {
    if (message.type !== 'warning' || typeof message.text !== 'string') return { ...message };
    const { text, ...options } = message;
    return new Warning(text, options) as ResultMessage;
  });
}

/** Mutable processing result shared with plugin callbacks. */
export class Result<P = unknown> {
  css = '';
  map?: ResultMap;
  /** Resolved external map path reported by Go, when present. */
  mapFile?: string;
  declare root: ProcessRoot;
  messages: ResultMessage[] = [];
  opts: ProcessFileOptions;
  processor: ResultProcessor;
  lastPlugin?: P;
  /** Backend that parsed and stringified this result. */
  backend?: BackendKind;

  constructor(
    processor: ResultProcessor,
    root: ProcessRoot | (() => ProcessRoot) | undefined,
    opts: ProcessFileOptions = {},
  ) {
    this.processor = processor;
    this.opts = opts;
    let loaded: ProcessRoot | undefined = typeof root === 'function' ? undefined : root;
    let load: (() => ProcessRoot) | undefined = typeof root === 'function' ? root : undefined;
    Object.defineProperty(this, 'root', {
      configurable: true,
      enumerable: true,
      get: () => {
        if (loaded === undefined && load) {
          loaded = load();
          load = undefined;
        }
        return loaded as ProcessRoot;
      },
      set: (value: ProcessRoot) => {
        loaded = value;
        load = undefined;
      },
    });
  }

  get content(): string {
    return this.css;
  }

  warnings(): Warning[] {
    return this.messages.filter((message) => message.type === 'warning') as Warning[];
  }

  warn(text: string, options: WarningOptions = {}): Warning {
    const lastPluginName =
      this.lastPlugin && typeof this.lastPlugin !== 'string'
        ? (this.lastPlugin as { postcssPlugin?: string }).postcssPlugin
        : undefined;
    const warning = new Warning(text, { ...options, plugin: options.plugin ?? lastPluginName });
    this.messages.push(warning);
    return warning;
  }

  toString(): string {
    return this.css;
  }
}

/** Fill omitted `parent` on dependency messages from `opts.from`. */
export function fillDependencyParents(result: Pick<Result, 'messages' | 'opts'>): void {
  const parent = result.opts.from;
  if (typeof parent !== 'string') return;
  for (const message of result.messages) {
    if (
      (message.type === 'dependency' || message.type === 'dir-dependency') &&
      typeof message.parent !== 'string'
    ) {
      message.parent = parent;
    }
  }
}
