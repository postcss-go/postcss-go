import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { call } from './bridge';

// Sibling PostCSS lib modules exist only after these files are copied into
// vendor/postcss/lib by the upstream compat prepare script.
const nodeRequire = createRequire(__filename);
const load = (id: string): any => nodeRequire(id);
const AtRule = load('./at-rule');
const Comment = load('./comment');
const Container = load('./container');
const CssSyntaxError = load('./css-syntax-error');
const Declaration = load('./declaration');
const Document = load('./document');
const Input = load('./input');
const Root = load('./root');
const Rule = load('./rule');

type SourceDto = {
  start: { offset: number; [key: string]: unknown };
  end: { offset: number; [key: string]: unknown };
};

type NodeDto = {
  type: string;
  raws?: Record<string, unknown>;
  source?: SourceDto;
  selector?: string;
  name?: string;
  params?: string;
  block?: boolean;
  prop?: string;
  value?: string;
  important?: boolean;
  text?: string;
  nodes?: NodeDto[];
};

type BridgeSyntaxError = Error & {
  name: string;
  reason?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  source?: string;
  file?: string;
  plugin?: string;
  input?: {
    column?: number;
    line?: number;
    offset?: number;
    source?: string;
    file?: string;
    sourceMapPresent?: boolean;
  };
};

function sourceOf(dto: SourceDto | undefined, input: unknown) {
  if (!dto) return undefined;
  return {
    start: { ...dto.start },
    end: { ...dto.end },
    input,
  };
}

function nodeOf(dto: NodeDto, input: unknown): any {
  const defaults: Record<string, unknown> = { raws: dto.raws || {} };
  if (dto.source) {
    defaults.source = sourceOf(dto.source, input);
    if (dto.type === 'atrule' && !dto.params && dto.source.start.offset === dto.source.end.offset) {
      delete (defaults.source as { end?: unknown }).end;
    }
  }

  let node: any;
  switch (dto.type) {
    case 'root':
      node = new Root(defaults);
      break;
    case 'document':
      node = new Document(defaults);
      break;
    case 'rule':
      node = new Rule({ ...defaults, selector: dto.selector || '' });
      break;
    case 'atrule':
      node = new AtRule({
        ...defaults,
        name: dto.name,
        params: dto.params || '',
        ...(dto.block ? { nodes: [] } : {}),
      });
      break;
    case 'decl':
      node = new Declaration({
        ...defaults,
        prop: dto.prop,
        value: dto.value,
        important: dto.important,
      });
      break;
    case 'comment':
      node = new Comment({ ...defaults, text: dto.text });
      break;
    default:
      throw new Error(`Unsupported Go AST node type: ${dto.type}`);
  }

  if (dto.nodes && dto.nodes.length) {
    node.append(dto.nodes.map((child) => nodeOf(child, input)));
  }
  return node;
}

const trailingSourceMapAnnotation = /(?:\r?\n|\s)*\/\*#\s*sourceMappingURL=[\s\S]*?\*\/\s*$/;

function cssWithoutSourceMapAnnotation(css: string) {
  return css.replace(trailingSourceMapAnnotation, '');
}

function usablePreviousMap(input: { map?: { text?: string } }) {
  const text = input.map?.text || '';
  if (!text) return '';
  try {
    const map = JSON.parse(text);
    if (typeof map.mappings === 'string') return map.mappings ? text : '';
    return Array.isArray(map.sections) && map.sections.length ? text : '';
  } catch {
    return '';
  }
}

function syntaxErrorFromBridge(error: unknown) {
  const bridgeError = error as BridgeSyntaxError;
  if (!bridgeError || bridgeError.name !== 'CssSyntaxError') return error;

  const line = bridgeError.line;
  const column =
    bridgeError.column === undefined && bridgeError.input?.sourceMapPresent
      ? 0
      : bridgeError.column;
  let reason = bridgeError.reason || bridgeError.message;
  if (reason === 'Unclosed block: missing closing brace') {
    reason = 'Unclosed block';
  } else if (reason === 'Unknown word: expected declaration') {
    const source = bridgeError.source || bridgeError.input?.source || '';
    const offset = bridgeError.input?.offset ?? 0;
    const word = source.slice(offset).match(/^[\w-]+/)?.[0] || '';
    reason = word ? `Unknown word ${word}` : 'Unknown word';
  }
  const source =
    bridgeError.source ||
    (bridgeError.input?.sourceMapPresent ? undefined : bridgeError.input?.source);
  const syntaxError = new CssSyntaxError(
    reason,
    line,
    column,
    source,
    bridgeError.file,
    bridgeError.plugin,
  );
  if (bridgeError.endLine !== undefined) syntaxError.endLine = bridgeError.endLine;
  if (bridgeError.endColumn !== undefined) syntaxError.endColumn = bridgeError.endColumn;
  if (reason.startsWith('Unknown word') && syntaxError.endColumn === undefined) {
    syntaxError.endLine = line;
    syntaxError.endColumn = (column ?? 0) + reason.slice('Unknown word '.length).length;
  }
  if (syntaxError.setMessage) syntaxError.setMessage();
  if (bridgeError.input) {
    const inputInfo: Record<string, unknown> = {
      column: bridgeError.input.column,
      endColumn: undefined,
      endLine: undefined,
      endOffset: undefined,
      line: bridgeError.input.line,
      offset: bridgeError.input.offset,
      source: bridgeError.input.source,
    };
    if (syntaxError.endColumn !== undefined) {
      inputInfo.endColumn = syntaxError.endColumn;
      inputInfo.endLine = syntaxError.endLine;
      inputInfo.endOffset = (bridgeError.input.offset ?? 0) + syntaxError.endColumn - (column ?? 0);
    }
    if (bridgeError.input.file) {
      inputInfo.file = bridgeError.input.file;
      inputInfo.url = pathToFileURL(bridgeError.input.file).toString();
    }
    syntaxError.input = {
      ...inputInfo,
    };
  }
  return syntaxError;
}

function parse(css: { toString(): string } | string | null | undefined, opts: any = {}) {
  const text = css == null ? css : css.toString();
  const input = new Input(text, opts);
  // Custom syntax runs through the normal stringify path, where the
  // annotation is removed by PostCSS's map generator. Keep it in the normal
  // path so the standard annotation and source-map tests retain their raw
  // formatting semantics.
  const parseText =
    opts.syntax || opts.parser ? cssWithoutSourceMapAnnotation(String(text ?? '')) : text;
  let result: { root: NodeDto };
  try {
    result = call('parse', {
      css: parseText,
      options: {
        from: input.file || opts.from || '',
        previousMap: usablePreviousMap(input),
        previousMapUrl: input.map?.mapFile || input.file || '',
      },
    }) as { root: NodeDto };
  } catch (error) {
    throw syntaxErrorFromBridge(error);
  }
  return nodeOf(result.root, input);
}

parse.default = parse;
Container.registerParse(parse);

export = parse;
