import type { PreviousMap } from './previous-map.js';

export interface SourcePosition {
  line: number;
  column: number;
  offset: number;
}

export interface SourceInput {
  css?: string;
  file?: string;
  from?: string;
  id?: string;
  map?: PreviousMap | Record<string, unknown>;
  toJSON?: () => Record<string, unknown>;
  [property: string]: unknown;
}

export interface SourceLocation {
  start: SourcePosition;
  end: SourcePosition;
  file?: string;
  input?: SourceInput;
}

export interface Warning {
  type: 'warning';
  text: string;
  plugin?: string;
}

export interface RawValue {
  raw: string;
  value: string;
}

export type RawField =
  | string
  | number
  | boolean
  | null
  | RawValue
  | RawField[]
  | { [key: string]: RawField | undefined };

export interface Raws {
  before?: string;
  after?: string;
  between?: string;
  afterName?: string;
  important?: string;
  left?: string;
  right?: string;
  indent?: string;
  semicolon?: boolean;
  ownSemicolon?: string;
  selector?: RawValue;
  params?: RawValue;
  value?: RawValue;
  [key: string]: RawField | undefined;
}

export interface DeclarationNode {
  type: 'decl';
  prop: string;
  value: string;
  important?: boolean;
  source?: SourceLocation;
  raws?: Raws;
}

export interface CommentNode {
  type: 'comment';
  text: string;
  source?: SourceLocation;
  raws?: Raws;
}

export interface RuleNode {
  type: 'rule';
  selector: string;
  nodes: AstNode[];
  source?: SourceLocation;
  raws?: Raws;
}

export interface AtRuleNode {
  type: 'atrule';
  name: string;
  params: string;
  block?: boolean;
  nodes?: AstNode[];
  source?: SourceLocation;
  raws?: Raws;
}

export interface RootNode {
  type: 'root';
  nodes: AstNode[];
  source?: SourceLocation;
  raws?: Raws;
}

export interface DocumentNode {
  type: 'document';
  nodes: RootNode[];
  source?: SourceLocation;
  raws?: Raws;
}

export type AstNode =
  | RootNode
  | DocumentNode
  | RuleNode
  | AtRuleNode
  | DeclarationNode
  | CommentNode;

export type PreviousSourceMap =
  | false
  | string
  | Record<string, unknown>
  | ((file?: string) => false | string | Record<string, unknown> | undefined);

export interface SourceMapOptions {
  absolute?: boolean;
  annotation?:
    | boolean
    | string
    | ((file: string | undefined, root: RootNode) => string | Promise<string>);
  from?: string;
  inline?: boolean;
  prev?: PreviousSourceMap;
  sourcesContent?: boolean;
}

export interface ProcessOptions {
  from?: string;
  to?: string;
  parser?: CustomParser;
  syntax?: Syntax;
  stringifier?: CustomStringifier;
  map?: boolean | SourceMapOptions;
  mapAuto?: boolean;
  mapFile?: string;
  previousMap?: string;
  previousMapPath?: string;
  previousMapUrl?: string;
  previousMapDisabled?: boolean;
  sourceMapFrom?: string;
  sourcesContent?: boolean;
  absolute?: boolean;
  preserveAnnotation?: boolean;
  /** When set, forces inline (`true`) or non-inline (`false`) map output. Omit to leave unset for Go defaults / `mapInlineAuto`. */
  mapInline?: boolean;
  mapInlineAuto?: boolean;
  mapAnnotation?: string;
  mapAnnotationDefault?: boolean;
  mapAnnotationDisabled?: boolean;
  [option: string]: unknown;
}

export interface ProcessResult {
  css: string;
  map?: string;
  /**
   * Bridge services return a DTO tree; public `process()` hydrates this to a
   * live `Root` or `Document` before returning to callers.
   */
  root: RootNode | DocumentNode | import('./ast.js').ProcessRoot;
  messages: Warning[];
}

/** A source map value returned by postcss-go. */
export interface SourceMap {
  toString(): string;
  toJSON?(): Record<string, unknown>;
}

/** Parser contract accepted by JavaScript-only integration points. */
export type CustomParserResult = AstNode | import('./ast.js').Node;
export type CustomParser = (
  css: string | { toString(): string },
  options?: ProcessOptions,
) => CustomParserResult | Promise<CustomParserResult>;

/** Builder callback used by a custom stringifier. */
export type StringifierBuilder = (chunk: string, node?: unknown, type?: string) => void;

/** Stringifier contract accepted by JavaScript-only integration points. */
export type CustomStringifier = (
  node: unknown,
  builder: StringifierBuilder,
) => void | Promise<void>;

export interface Syntax {
  parse?: CustomParser;
  stringify?: CustomStringifier;
}

export interface NoWorkResult {
  css: string;
  map?: string;
}

export interface AstStringifyResult {
  css: string;
  map?: string;
}

export interface ParseResult {
  root: RootNode;
}
