export interface SourcePosition {
  line: number;
  column: number;
  offset: number;
}

export interface SourceLocation {
  start: SourcePosition;
  end: SourcePosition;
  file?: string;
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

export type AstNode = RootNode | RuleNode | AtRuleNode | DeclarationNode | CommentNode;

export type PreviousSourceMap =
  | false
  | string
  | Record<string, unknown>
  | ((file?: string) => false | string | Record<string, unknown> | undefined);

export interface SourceMapOptions {
  absolute?: boolean;
  annotation?: boolean | string | ((file: string | undefined, root: RootNode) => string);
  from?: string;
  inline?: boolean;
  prev?: PreviousSourceMap;
  sourcesContent?: boolean;
}

export interface ProcessOptions {
  from?: string;
  to?: string;
  map?: boolean | SourceMapOptions;
  mapFile?: string;
  previousMap?: string;
  previousMapUrl?: string;
  previousMapDisabled?: boolean;
  sourceMapFrom?: string;
  sourcesContent?: boolean;
  absolute?: boolean;
  preserveAnnotation?: boolean;
}

export interface ProcessResult {
  css: string;
  map?: string;
  root: RootNode;
  messages: Warning[];
}

export interface ParseResult {
  root: RootNode;
}
