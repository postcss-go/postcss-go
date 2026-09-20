import type { ProcessRoot } from './ast.js';
import type { ProcessFileOptions } from '@postcss-go/shared/map-options';
import { Warning, type WarningOptions } from './warning.js';
import type { ResultMessage, SourceMap } from './types.js';
import type { BackendKind } from './service.js';

export interface ResultProcessor {
  plugins: unknown[];
  version?: string;
}

type RawMap = {
  version: number;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: (string | null)[];
  names: string[];
  mappings: string;
};

type Mapping = {
  generated: { line: number; column: number };
  original?: { line: number; column: number };
  source?: string;
  name?: string;
};

/** PostCSS-shaped wrapper around the source-map JSON emitted by Go. */
export class ResultMap implements SourceMap {
  private mutated?: RawMap;

  constructor(private readonly text: string) {}

  toJSON(): Record<string, unknown> {
    return this.ensureJSON() as unknown as Record<string, unknown>;
  }

  toString(): string {
    return this.mutated ? JSON.stringify(this.mutated) : this.text;
  }

  addMapping(mapping: Mapping): void {
    const json = this.ensureJSON();
    if (mapping.source && !json.sources.includes(mapping.source)) {
      json.sources.push(mapping.source);
      json.sourcesContent = alignContents(json);
    }
    if (mapping.name && !json.names.includes(mapping.name)) json.names.push(mapping.name);
  }

  setSourceContent(sourceFile: string, sourceContent: string | null | undefined): void {
    const json = this.ensureJSON();
    if (!json.sources.includes(sourceFile)) json.sources.push(sourceFile);
    json.sourcesContent = alignContents(json);
    json.sourcesContent[json.sources.indexOf(sourceFile)] = sourceContent ?? null;
  }

  applySourceMap(
    consumer: { sources?: string[]; sourcesContent?: (string | null)[]; toJSON?(): unknown },
    sourceFile?: string,
  ): void {
    const json = this.ensureJSON();
    const incoming =
      typeof consumer.toJSON === 'function'
        ? (consumer.toJSON() as RawMap)
        : (consumer as { sources?: string[]; sourcesContent?: (string | null)[] });
    const incomingSources = incoming.sources ?? [];
    for (const source of incomingSources) {
      if (!json.sources.includes(source)) json.sources.push(source);
    }
    if (sourceFile && !json.sources.includes(sourceFile)) json.sources.push(sourceFile);
    json.sourcesContent = alignContents(json);
    const incomingContents = incoming.sourcesContent ?? [];
    incomingSources.forEach((source, index) => {
      const slot = json.sources.indexOf(source);
      if (slot >= 0 && incomingContents[index] != null)
        json.sourcesContent![slot] = incomingContents[index];
    });
  }

  private ensureJSON(): RawMap {
    if (this.mutated) return this.mutated;
    try {
      const parsed = JSON.parse(this.text) as RawMap;
      this.mutated = {
        version: parsed.version ?? 3,
        file: parsed.file,
        sources: [...(parsed.sources ?? [])],
        sourcesContent: parsed.sourcesContent ? [...parsed.sourcesContent] : undefined,
        names: [...(parsed.names ?? [])],
        mappings: parsed.mappings ?? '',
      };
      if (parsed.sourceRoot) this.mutated.sourceRoot = parsed.sourceRoot;
      return this.mutated;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`postcss-go result map is not valid JSON: ${detail}`, { cause: error });
    }
  }
}

function alignContents(json: RawMap): (string | null)[] {
  const contents = json.sourcesContent ?? [];
  return json.sources.map((_, index) => contents[index] ?? null);
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
