import type {
  AstNode as AstDTO,
  AtRuleNode as AtRuleDTO,
  CommentNode as CommentDTO,
  DeclarationNode as DeclarationDTO,
  DocumentNode as DocumentDTO,
  RawField,
  Raws,
  RootNode as RootDTO,
  RuleNode as RuleDTO,
  SourceLocation,
} from './types.js';
import type { PostcssGoService } from './service.js';
import type { ProcessOptions } from './types.js';

export type NodeType = AstDTO['type'] | 'document';

export interface NodeInit {
  type?: NodeType;
  source?: SourceLocation;
  raws?: Raws;
}

type NodeInput = Node | AstDTO | NodeInit;
type NodeChild = NodeInput | NodeInput[];
type ContainerInit = NodeInit & { nodes?: NodeChild[] };

function isNode(value: unknown): value is Node {
  return value instanceof Node;
}

function cloneRaw(value: RawField | undefined): RawField | undefined {
  if (Array.isArray(value)) return value.map((item) => cloneRaw(item)) as RawField[];
  if (value && typeof value === 'object') {
    const result: Record<string, RawField | undefined> = {};
    for (const [key, item] of Object.entries(value)) result[key] = cloneRaw(item);
    return result;
  }
  return value;
}

function cloneRaws(raws: Raws | undefined): Raws {
  const result: Raws = {};
  for (const [key, value] of Object.entries(raws ?? {})) result[key] = cloneRaw(value);
  return result;
}

function asNode(value: Node | AstDTO | NodeInit): Node {
  if (isNode(value)) return value;
  const node = value as NodeInit & { type?: NodeType; nodes?: NodeChild[] };
  switch (node.type) {
    case 'root':
      return new Root(node);
    case 'document':
      return new Document(node);
    case 'rule':
      return new Rule(node);
    case 'atrule':
      return new AtRule(node);
    case 'decl':
      return new Declaration(node);
    case 'comment':
      return new Comment(node);
    default:
      if ('prop' in node) return new Declaration(node as NodeInit & DeclarationDTO);
      if ('selector' in node) return new Rule(node as ContainerInit & RuleDTO);
      if ('name' in node) return new AtRule(node as ContainerInit & AtRuleDTO);
      if ('text' in node) return new Comment(node as NodeInit & CommentDTO);
      if ('nodes' in node) return new Root(node);
      throw new Error(`Unsupported AST node type: ${String(node.type)}`);
  }
}

export abstract class Node {
  readonly type: NodeType;
  source?: SourceLocation;
  raws: Raws;
  private readonly rawsProvided: boolean;
  private parentNode?: Container;
  private clean = false;

  protected constructor(type: NodeType, init: NodeInit = {}) {
    this.type = type;
    this.source = init.source;
    this.raws = cloneRaws(init.raws);
    this.rawsProvided = init.raws !== undefined;
  }

  get parent(): Container | undefined {
    return this.parentNode;
  }

  setParent(parent: Container | undefined): void {
    this.parentNode = parent;
  }

  addToError<T extends Error>(error: T): T {
    Object.assign(error, { postcssNode: this });
    return error;
  }

  assign(overrides: Record<string, unknown> = {}): this {
    Object.assign(this, overrides);
    this.markDirty();
    return this;
  }

  root(): Node {
    let current = this.parent;
    while (current?.parent && current.parent.type !== 'document') current = current.parent;
    return current?.type === 'document' ? this : (current ?? this);
  }

  next(): Node | undefined {
    if (!this.parent) return undefined;
    return this.parent.nodes[this.parent.index(this) + 1];
  }

  prev(): Node | undefined {
    if (!this.parent) return undefined;
    return this.parent.nodes[this.parent.index(this) - 1];
  }

  remove(): this {
    if (this.parent) this.parent.removeChild(this);
    return this;
  }

  replaceWith(...nodes: Array<Node | AstDTO | NodeInit>): this {
    if (!this.parent) throw new Error('Cannot replace a node without a parent');
    const parent = this.parent;
    const index = parent.index(this);
    parent.removeChild(this);
    parent.insertBeforeIndex(index, nodes.map(asNode));
    return this;
  }

  clone(overrides: NodeInit = {}): this {
    const copy = asNode(this.toJSON()) as this;
    Object.assign(copy, overrides);
    return copy;
  }

  cloneBefore(overrides: NodeInit = {}): this {
    const copy = this.clone(overrides);
    if (!this.parent) throw new Error('Cannot clone before a node without a parent');
    this.parent.insertBefore(this, copy);
    return copy;
  }

  cloneAfter(overrides: NodeInit = {}): this {
    const copy = this.clone(overrides);
    if (!this.parent) throw new Error('Cannot clone after a node without a parent');
    this.parent.insertAfter(this, copy);
    return copy;
  }

  before(...nodes: Array<Node | AstDTO | NodeInit>): this {
    if (!this.parent) throw new Error('Cannot insert before a node without a parent');
    this.parent.insertBefore(this, ...nodes);
    return this;
  }

  after(...nodes: Array<Node | AstDTO | NodeInit>): this {
    if (!this.parent) throw new Error('Cannot insert after a node without a parent');
    this.parent.insertAfter(this, ...nodes);
    return this;
  }

  cleanRaws(keepBetween = false): this {
    delete this.raws.before;
    delete this.raws.after;
    if (!keepBetween) delete this.raws.between;
    return this;
  }

  markClean(): this {
    this.clean = true;
    return this;
  }

  markDirty(): this {
    this.clean = false;
    if (this.parent) this.parent.markDirty();
    return this;
  }

  raw(prop: string, defaultType?: string): string {
    const value = this.raws[prop];
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && !Array.isArray(value) && 'raw' in value) {
      return String(value.raw);
    }
    return defaultRaw(this, defaultType);
  }

  positionInside(index: number): SourceLocation['start'] {
    const start = this.source?.start;
    if (!start) return { line: 1, column: index + 1, offset: index };
    return { line: start.line, column: start.column + index, offset: start.offset + index };
  }

  positionBy(options: { index?: number; word?: string } = {}): SourceLocation['start'] {
    if (options.index !== undefined) return this.positionInside(options.index);
    if (options.word && this.source) {
      const text = this.toText();
      const index = text.indexOf(options.word);
      if (index >= 0) return this.positionInside(index);
    }
    return this.source?.start ?? this.positionInside(0);
  }

  rangeBy(
    options: {
      index?: number;
      endIndex?: number;
      word?: string;
      start?: SourceLocation['start'];
      end?: SourceLocation['end'];
    } = {},
  ): { start: SourceLocation['start']; end: SourceLocation['end'] } {
    const start = options.start ?? this.positionBy(options);
    let end = options.end ?? this.source?.end ?? this.positionInside(1);
    if (options.endIndex !== undefined) end = this.positionInside(options.endIndex);
    if (options.word) {
      const index = this.toText().indexOf(options.word);
      if (index >= 0) {
        return {
          start: this.positionInside(index),
          end: this.positionInside(index + options.word.length),
        };
      }
    }
    if (end.line < start.line || (end.line === start.line && end.column <= start.column)) {
      end = this.positionInside(Math.max(1, (options.index ?? 0) + 1));
    }
    return { start, end };
  }

  protected toText(): string {
    return this.toJSONText();
  }

  private toJSONText(): string {
    const value = this.toJSON() as unknown as Record<string, unknown>;
    return String(value.selector ?? value.value ?? value.params ?? value.text ?? '');
  }

  error(
    message: string,
    options: {
      plugin?: string;
      index?: number;
      endIndex?: number;
      word?: string;
      start?: SourceLocation['start'];
      end?: SourceLocation['end'];
    } = {},
  ): Error {
    const range = this.rangeBy(options);
    const error = new Error(message);
    Object.assign(error, {
      name: 'CssSyntaxError',
      reason: message,
      plugin: options.plugin,
      line: range.start.line,
      column: range.start.column,
      endLine: range.end.line,
      endColumn: range.end.column,
      file: this.source?.file,
      postcssNode: this,
    });
    return error;
  }

  toProxy(): this {
    return this;
  }

  toString(): string {
    return stringifyNode(this);
  }

  warn(
    result: { messages?: Array<Record<string, unknown>> },
    text: string,
    options: { plugin?: string; index?: number; word?: string } = {},
  ): Record<string, unknown> {
    const warning = {
      type: 'warning',
      text,
      plugin: options.plugin,
      node: this,
      ...this.rangeBy(options),
    };
    (result.messages ??= []).push(warning);
    return warning;
  }

  protected jsonMeta(): { source?: SourceLocation; raws?: Raws } {
    const meta: { source?: SourceLocation; raws?: Raws } = {};
    if (this.source !== undefined) meta.source = this.source;
    if (this.rawsProvided || Object.keys(this.raws).length > 0) meta.raws = cloneRaws(this.raws);
    return meta;
  }

  abstract toJSON(): AstDTO;
}

export abstract class Container extends Node {
  nodes: Node[];

  protected constructor(type: NodeType, init: ContainerInit = {}) {
    super(type, init);
    this.nodes = [];
    for (const child of init.nodes ?? []) this.append(child);
  }

  get first(): Node | undefined {
    return this.nodes[0];
  }
  get last(): Node | undefined {
    return this.nodes[this.nodes.length - 1];
  }

  append(...children: NodeChild[]): this {
    const nodes = this.normalize(children);
    for (const node of nodes) {
      if (node.parent) node.parent.removeChild(node);
      this.inheritBefore(node, this.last);
      node.setParent(this);
      this.nodes.push(node);
    }
    return this;
  }

  push(child: NodeChild): this {
    return this.append(child);
  }

  each(callback: (node: Node, index: number) => unknown): unknown {
    let index = 0;
    let result: unknown;
    while (index < this.nodes.length) {
      const child = this.nodes[index];
      result = callback(child, index);
      if (result === false) break;
      if (this.nodes[index] === child) index++;
    }
    return result;
  }

  prepend(...children: NodeChild[]): this {
    const nodes = this.normalize(children).reverse();
    for (const node of nodes) {
      if (node.parent) node.parent.removeChild(node);
      this.inheritBefore(node, this.first);
      node.setParent(this);
      this.nodes.unshift(node);
    }
    return this;
  }

  insertBefore(existing: Node, ...children: NodeChild[]): this {
    const index = this.index(existing);
    if (index < 0) throw new Error('Node is not a child of this container');
    this.insertBeforeIndex(index, this.normalize(children), existing);
    return this;
  }

  insertAfter(existing: Node, ...children: NodeChild[]): this {
    const index = this.index(existing);
    if (index < 0) throw new Error('Node is not a child of this container');
    this.insertBeforeIndex(index + 1, this.normalize(children), existing);
    return this;
  }

  insertBeforeIndex(index: number, children: Node[], sample?: Node): void {
    for (const node of children) {
      if (node.parent) node.parent.removeChild(node);
      this.inheritBefore(node, sample ?? this.nodes[index]);
      node.setParent(this);
    }
    this.nodes.splice(index, 0, ...children);
  }

  private normalize(children: NodeChild[]): Node[] {
    const nodes: Node[] = [];
    for (const child of children) {
      if (Array.isArray(child)) {
        nodes.push(...this.normalize(child));
        continue;
      }
      const node = asNode(child);
      if (this.type !== 'document' && node.type === 'root') {
        nodes.push(...(node as Root).nodes);
      } else {
        nodes.push(node);
      }
    }
    return nodes;
  }

  private inheritBefore(node: Node, sample: Node | undefined): void {
    if (!sample || node.raws.before !== undefined || sample.raws.before === undefined) return;
    node.raws.before = sample.raws.before.replace(/\S/g, '');
  }

  removeChild(child: Node): this {
    const index = this.index(child);
    if (index < 0) throw new Error('Node is not a child of this container');
    this.nodes[index].setParent(undefined);
    this.nodes.splice(index, 1);
    return this;
  }

  index(child: Node | number): number {
    return typeof child === 'number' ? child : this.nodes.indexOf(child);
  }

  removeAll(): this {
    for (const node of this.nodes) node.setParent(undefined);
    this.nodes = [];
    return this;
  }

  cleanRaws(keepBetween = false): this {
    super.cleanRaws(keepBetween);
    for (const node of this.nodes) node.cleanRaws(keepBetween);
    return this;
  }

  replaceValues(
    pattern: string | RegExp,
    optionsOrCallback: { props?: string[]; fast?: string } | ((...args: any[]) => string),
    maybeCallback?: (...args: any[]) => string,
  ): this {
    const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    if (!callback) throw new Error('replaceValues requires a callback');
    this.walkDecls((decl) => {
      if (options.props && !options.props.includes(decl.prop)) return;
      if (options.fast && !decl.value.includes(options.fast)) return;
      decl.value = decl.value.replace(pattern as never, callback as never);
    });
    return this;
  }

  some(callback: (node: Node, index: number) => boolean): boolean {
    return this.nodes.some(callback);
  }
  every(callback: (node: Node, index: number) => boolean): boolean {
    return this.nodes.every(callback);
  }

  walk(callback: (node: Node, index: number) => unknown): unknown {
    return this.each((child, index) => {
      const result = callback(child, index);
      if (result !== false && child instanceof Container) return child.walk(callback);
      return result;
    });
  }

  walkAtRules(
    nameOrCallback: string | RegExp | ((node: AtRule, index: number) => unknown),
    callback?: (node: AtRule, index: number) => unknown,
  ): unknown {
    const matches = (node: Node): node is AtRule => {
      if (!(node instanceof AtRule)) return false;
      if (typeof nameOrCallback === 'function') return true;
      if (nameOrCallback instanceof RegExp) {
        nameOrCallback.lastIndex = 0;
        return nameOrCallback.test(node.name);
      }
      return node.name === nameOrCallback;
    };
    const visit = typeof nameOrCallback === 'function' ? nameOrCallback : callback;
    if (!visit) throw new Error('walkAtRules requires a callback');
    return this.walk((node, index) => (matches(node) ? visit(node, index) : undefined));
  }

  walkComments(callback: (node: Comment, index: number) => unknown): unknown {
    return this.walk((node, index) =>
      node instanceof Comment ? callback(node, index) : undefined,
    );
  }

  walkDecls(
    propOrCallback: string | RegExp | ((node: Declaration, index: number) => unknown),
    callback?: (node: Declaration, index: number) => unknown,
  ): unknown {
    const matches = (node: Node): node is Declaration => {
      if (!(node instanceof Declaration)) return false;
      if (typeof propOrCallback === 'function') return true;
      if (propOrCallback instanceof RegExp) {
        propOrCallback.lastIndex = 0;
        return propOrCallback.test(node.prop);
      }
      return node.prop === propOrCallback;
    };
    const visit = typeof propOrCallback === 'function' ? propOrCallback : callback;
    if (!visit) throw new Error('walkDecls requires a callback');
    return this.walk((node, index) => (matches(node) ? visit(node, index) : undefined));
  }

  walkRules(
    selectorOrCallback: string | RegExp | ((node: Rule, index: number) => unknown),
    callback?: (node: Rule, index: number) => unknown,
  ): unknown {
    const matches = (node: Node): node is Rule => {
      if (!(node instanceof Rule)) return false;
      if (typeof selectorOrCallback === 'function') return true;
      if (selectorOrCallback instanceof RegExp) {
        selectorOrCallback.lastIndex = 0;
        return selectorOrCallback.test(node.selector);
      }
      return node.selector === selectorOrCallback;
    };
    const visit = typeof selectorOrCallback === 'function' ? selectorOrCallback : callback;
    if (!visit) throw new Error('walkRules requires a callback');
    return this.walk((node, index) => (matches(node) ? visit(node, index) : undefined));
  }
}

export class Root extends Container {
  constructor(init: ContainerInit = {}) {
    super('root', init);
  }
  async toResult(options: ProcessOptions = {}, service?: PostcssGoService) {
    const { toResult } = await import('./api.js');
    return toResult(this, options, service);
  }
  toJSON(): RootDTO {
    return { type: 'root', nodes: this.nodes.map((node) => node.toJSON()), ...this.jsonMeta() };
  }
}

export class Document extends Container {
  constructor(init: ContainerInit = {}) {
    super('document', init);
  }

  async toResult(options: ProcessOptions = {}, service?: PostcssGoService) {
    const { toResult } = await import('./api.js');
    return toResult(this, options, service);
  }

  toJSON(): DocumentDTO {
    return {
      type: 'document',
      nodes: this.nodes.map((node) => node.toJSON()) as RootDTO[],
      ...this.jsonMeta(),
    };
  }
}

export class Rule extends Container {
  selector: string;
  constructor(init: ContainerInit = {}) {
    super('rule', init);
    this.selector = String((init as RuleDTO).selector ?? '');
  }
  get selectors(): string[] {
    return splitList(this.selector, ',');
  }
  set selectors(values: string[]) {
    const match = this.selector.match(/,\s*/);
    this.selector = values.join(match?.[0] ?? ',');
  }
  toJSON(): RuleDTO {
    return {
      type: 'rule',
      selector: this.selector,
      nodes: this.nodes.map((node) => node.toJSON()),
      ...this.jsonMeta(),
    };
  }
}

export class AtRule extends Container {
  name: string;
  params: string;
  constructor(init: ContainerInit = {}) {
    super('atrule', init);
    this.name = String((init as AtRuleDTO).name ?? '');
    this.params = String((init as AtRuleDTO).params ?? '');
  }
  toJSON(): AtRuleDTO {
    return {
      type: 'atrule',
      name: this.name,
      params: this.params,
      ...(this.nodes.length ? { nodes: this.nodes.map((node) => node.toJSON()) } : {}),
      ...this.jsonMeta(),
    };
  }
}

export class Declaration extends Node {
  prop: string;
  value: string;
  important: boolean;
  constructor(init: NodeInit = {}) {
    super('decl', init);
    this.prop = String((init as DeclarationDTO).prop ?? '');
    this.value = String((init as DeclarationDTO).value ?? '');
    this.important = Boolean((init as DeclarationDTO).important);
  }
  get variable(): boolean {
    return this.prop.startsWith('--') || this.prop.startsWith('$');
  }
  toJSON(): DeclarationDTO {
    return {
      type: 'decl',
      prop: this.prop,
      value: this.value,
      important: this.important,
      ...this.jsonMeta(),
    };
  }
}

export class Comment extends Node {
  text: string;
  constructor(init: NodeInit = {}) {
    super('comment', init);
    this.text = String((init as CommentDTO).text ?? '');
  }
  toJSON(): CommentDTO {
    return { type: 'comment', text: this.text, ...this.jsonMeta() };
  }
}

export function fromAst(node: AstDTO): Node {
  return asNode(node);
}

/** Rehydrate a serialized PostCSS-shaped AST, including arrays of nodes. */
export function fromJSON<T extends AstDTO | AstDTO[]>(
  value: T,
): T extends AstDTO[] ? Node[] : Node {
  if (Array.isArray(value))
    return value.map((node) => asNode(node)) as T extends AstDTO[] ? Node[] : Node;
  return asNode(value) as T extends AstDTO[] ? Node[] : Node;
}

export function toAst(node: Node): AstDTO {
  return node.toJSON();
}

function rawValue(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value) && 'raw' in value) {
    const rawValue = value as { raw: unknown; value?: unknown };
    if (rawValue.value === undefined || String(rawValue.value) === fallback) {
      return String(rawValue.raw);
    }
  }
  return fallback;
}

function defaultRaw(node: Node, type?: string): string {
  if (type === 'beforeOpen') return node instanceof Rule ? ' ' : '';
  if (type === 'beforeDecl') return node.parent?.first === node ? '' : '\n';
  if (type === 'beforeComment') return node.parent?.first === node ? '' : '\n';
  if (type === 'beforeRule') return node.parent?.first === node ? '' : '\n';
  if (type === 'colon') return ': ';
  if (type === 'emptyBody') return '';
  return '';
}

function stringifyNode(node: Node): string {
  const before = rawValue(node.raws.before, '');
  if (node instanceof Document || node instanceof Root) {
    const body = node.nodes.map(stringifyNode).join('');
    return `${before}${body}${rawValue(node.raws.after, '')}`;
  }
  if (node instanceof Rule) {
    const selector = rawValue(node.raws.selector, node.selector);
    const body = node.nodes.map(stringifyNode).join('');
    const after = rawValue(node.raws.after, '');
    return `${before}${selector}${rawValue(node.raws.between, ' ')}{${body}${after}}`;
  }
  if (node instanceof AtRule) {
    const params = node.params ? ` ${rawValue(node.raws.params, node.params)}` : '';
    const name = `@${node.name}${rawValue(node.raws.afterName, '')}${params}`;
    if (node.nodes.length) {
      const body = node.nodes.map(stringifyNode).join('');
      return `${before}${name}${rawValue(node.raws.between, ' ')}{${body}${rawValue(node.raws.after, '')}}`;
    }
    return `${before}${name};`;
  }
  if (node instanceof Declaration) {
    const value = rawValue(node.raws.value, node.value);
    const important = node.important ? rawValue(node.raws.important, ' !important') : '';
    const parent = node.parent;
    const semicolon =
      node.raws.ownSemicolon === ';' ||
      (parent !== undefined && parent.raws.semicolon === true && parent.last === node);
    return `${before}${node.prop}${rawValue(node.raws.between, ': ')}${value}${important}${semicolon ? ';' : ''}`;
  }
  if (node instanceof Comment) {
    return `${before}/*${node.text}*/${rawValue(node.raws.after, '')}`;
  }
  return before;
}

function splitList(value: string, separator: string): string[] {
  const result: string[] = [];
  let current = '';
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (const char of value) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === '(') {
      depth++;
      current += char;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
      current += char;
    } else if (char === separator && depth === 0) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current !== '' || value.endsWith(separator)) result.push(current.trim());
  return result;
}
