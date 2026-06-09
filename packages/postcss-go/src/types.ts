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

export interface DeclarationNode {
  type: 'decl';
  prop: string;
  value: string;
  important?: boolean;
  source?: SourceLocation;
}

export interface CommentNode {
  type: 'comment';
  text: string;
  source?: SourceLocation;
}

export interface RuleNode {
  type: 'rule';
  selector: string;
  nodes: AstNode[];
  source?: SourceLocation;
}

export interface AtRuleNode {
  type: 'atrule';
  name: string;
  params: string;
  block?: boolean;
  nodes?: AstNode[];
  source?: SourceLocation;
}

export interface RootNode {
  type: 'root';
  nodes: AstNode[];
  source?: SourceLocation;
}

export type AstNode = RootNode | RuleNode | AtRuleNode | DeclarationNode | CommentNode;

export interface ProcessOptions {
  from?: string;
}

export interface ProcessResult {
  css: string;
  root: RootNode;
  messages: Warning[];
}

export interface ParseResult {
  root: RootNode;
}
