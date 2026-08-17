import fs from 'node:fs';
import { SourceMapConsumer } from 'source-map-js';

export type ContractAst = {
  type: string;
  source?: { start: [number, number]; end: [number, number] };
  selector?: string;
  name?: string;
  params?: string;
  prop?: string;
  value?: string;
  text?: string;
  nodes?: ContractAst[];
};

export type CoreCssContract = {
  css: string;
  from: string;
  to: string;
  invalidCss: string;
  error: {
    line: number;
    column: number;
    reason: string;
  };
  previousMap: {
    version: number;
    file?: string;
    sources: string[];
    sourcesContent?: string[];
    names: string[];
    mappings: string;
  };
  previousSource: string;
  previousMapUrl: string;
  roundTrips: Array<{ name: string; css: string; ast: ContractAst }>;
  documentCss: string;
  noWorkCleanCss: string;
  mutation: { css: string; expectedCss: string };
  mapChecks: Array<{ generated: [number, number]; original: [number, number] }>;
  errors: Array<{
    name: string;
    css: string;
    line: number;
    column: number;
    reason: string;
  }>;
};

type SourceMapPayload = {
  version?: number;
  file?: string;
  sources?: string[];
  sourcesContent?: Array<string | null>;
  mappings?: string;
};

const fixtureUrl = new URL('../testdata/core-css-contract.json', import.meta.url);

export const coreCssContract = JSON.parse(fs.readFileSync(fixtureUrl, 'utf8')) as CoreCssContract;

export function expectUnchangedCoreCss(css: string): void {
  if (css !== coreCssContract.css) {
    throw new Error(
      `Core CSS contract output diverged from input\nwant: ${JSON.stringify(coreCssContract.css)}\ngot: ${JSON.stringify(css)}`,
    );
  }
}

export function normalizeContractAst(node: unknown): ContractAst {
  const current = node as Record<string, unknown>;
  const normalized: ContractAst = { type: String(current.type) };
  if (normalized.type === 'rule' && typeof current.selector === 'string') {
    normalized.selector = current.selector;
  } else if (normalized.type === 'atrule') {
    if (typeof current.name === 'string') normalized.name = current.name;
    if (typeof current.params === 'string') normalized.params = current.params;
  } else if (normalized.type === 'decl') {
    if (typeof current.prop === 'string') normalized.prop = current.prop;
    if (typeof current.value === 'string') normalized.value = current.value;
  } else if (normalized.type === 'comment' && typeof current.text === 'string') {
    normalized.text = current.text;
  }
  const source = current.source as
    | { start?: { line?: number; column?: number }; end?: { line?: number; column?: number } }
    | undefined;
  if (
    typeof source?.start?.line === 'number' &&
    typeof source.start.column === 'number' &&
    typeof source?.end?.line === 'number' &&
    typeof source.end.column === 'number'
  ) {
    normalized.source = {
      start: [source.start.line, source.start.column],
      end: [source.end.line, source.end.column],
    };
  }
  if (Array.isArray(current.nodes)) {
    normalized.nodes = current.nodes.map(normalizeContractAst);
  }
  return normalized;
}

export function stripSourceMapAnnotation(css: string): string {
  return css.replace(/(?:\r?\n)?\/\*[#@][^*]*sourceMappingURL=[\s\S]*?\*\//g, '');
}

export function parseContractSourceMap(map: unknown): SourceMapPayload {
  if (typeof map === 'string') return JSON.parse(map) as SourceMapPayload;
  if (map && typeof map === 'object') {
    const json =
      typeof (map as { toJSON?: () => unknown }).toJSON === 'function'
        ? (map as { toJSON: () => unknown }).toJSON()
        : map;
    if (typeof json === 'string') return JSON.parse(json) as SourceMapPayload;
    return json as SourceMapPayload;
  }
  throw new Error('Core CSS contract is missing a source map');
}

export function expectCoreCssSourceMap(map: unknown): void {
  const payload = parseContractSourceMap(map);
  if (payload.version !== 3 || !payload.mappings) {
    throw new Error(`unexpected Core CSS source map: ${JSON.stringify(payload)}`);
  }
  if (!payload.sources?.some((source) => source.endsWith('input.css'))) {
    throw new Error(`unexpected Core CSS map sources: ${JSON.stringify(payload.sources)}`);
  }
  if (payload.file !== 'output.css') {
    throw new Error(`unexpected Core CSS map file: ${JSON.stringify(payload.file)}`);
  }
  if (!payload.sourcesContent?.includes(coreCssContract.css)) {
    throw new Error(
      `Core CSS map is missing sourcesContent: ${JSON.stringify(payload.sourcesContent)}`,
    );
  }
  const consumer = new SourceMapConsumer(payload as never);
  for (const check of coreCssContract.mapChecks) {
    const original = consumer.originalPositionFor({
      line: check.generated[0],
      column: check.generated[1],
    });
    if (original.line !== check.original[0] || original.column !== check.original[1]) {
      throw new Error(
        `Core CSS mapping ${check.generated.join(':')} resolved to ${original.line}:${original.column}, expected ${check.original.join(':')}`,
      );
    }
  }
}

export function expectCoreCssPreviousMap(map: unknown): void {
  const payload = parseContractSourceMap(map);
  if (payload.version !== 3 || !payload.mappings) {
    throw new Error(`unexpected composed Core CSS source map: ${JSON.stringify(payload)}`);
  }
  if (!payload.sources?.some((source) => source.endsWith(coreCssContract.previousSource))) {
    throw new Error(
      `composed Core CSS map is missing ${coreCssContract.previousSource}: ${JSON.stringify(payload.sources)}`,
    );
  }
  if (!payload.sourcesContent?.includes(coreCssContract.css)) {
    throw new Error(
      `composed Core CSS map is missing original sourcesContent: ${JSON.stringify(payload.sourcesContent)}`,
    );
  }
}

export function cssWithPreviousMapAnnotation(): string {
  const encoded = Buffer.from(JSON.stringify(coreCssContract.previousMap), 'utf8').toString(
    'base64',
  );
  return `${coreCssContract.css}/*# sourceMappingURL=data:application/json;base64,${encoded} */\n`;
}

export const coreCssMapOptions = {
  inline: false,
  annotation: false,
} as const;

export const coreCssPreviousMapOptions = {
  prev: coreCssContract.previousMap,
  inline: false,
  annotation: false,
} as const;
