import type {
  AstNode as AstDTO,
  AtRuleNode as AtRuleDTO,
  CommentNode as CommentDTO,
  DeclarationNode as DeclarationDTO,
  DocumentNode as DocumentDTO,
  Raws,
  RootNode as RootDTO,
  RuleNode as RuleDTO,
  SourceLocation,
} from './types.js';
import {
  cloneRaws,
  cloneValue,
  finishJSON,
  INTERNAL_NODE_PROPERTIES,
  markBridgeBlocks,
  removeSource,
  restoreBridgeSources,
  serializeJSONValue,
} from './ast-utils.js';
import { defaultRaw } from './ast-stringifier.js';
import { stringify as stringifyOwned } from './ast-stringifier.js';
import { CssSyntaxError } from './errors.js';
import { hydrateInput } from './input.js';
import { list } from './list.js';
import { parseOwnedSync } from './parser.js';
import { Warning } from './warning.js';
import type { PostcssGoService } from './service.js';
import type { ProcessOptions } from './types.js';

export type NodeType = AstDTO['type'] | (string & {});

export interface NodeInit {
  type?: NodeType;
  source?: SourceLocation;
  raws?: Raws;
  [property: string]: unknown;
}

export type NodeInput = Node | AstDTO | NodeInit;
export type NodeChild = NodeInput | readonly NodeChild[] | string | undefined;
export type ChildNode = AtRule | Comment | Declaration | Rule;
export type AnyNode = ChildNode | Document | Root;
export interface ContainerInit extends NodeInit {
  nodes?: readonly NodeChild[];
}
export type RootInit = ContainerInit;
export type DocumentInit = ContainerInit;
export interface RuleInit extends ContainerInit {
  selector?: string;
  selectors?: readonly string[];
}
export interface AtRuleInit extends ContainerInit {
  name?: string;
  params?: string;
  block?: boolean;
}
export interface DeclarationInit extends NodeInit {
  prop?: string;
  value?: string | number;
  important?: boolean;
}
export interface CommentInit extends NodeInit {
  text?: string;
}

export type Builder = (chunk: string, node?: Node, type?: string) => void;
export type Stringifier = (node: Node, builder: Builder) => void;
/** Object form accepted by `Node#toString` (distinct from `ProcessOptions` `Syntax`). */
export type StringifierSyntax = { stringify: Stringifier };
export type WalkCallback<T extends Node = Node> = (node: T, index: number) => unknown;
/**
 * Insertion hint passed to `Container#normalize()`. `prepend` matches the PostCSS hint of the same
 * name; `hydrate` marks the constructor path, where children already carry authoritative raws.
 */
export type InsertMode = 'hydrate' | 'prepend' | undefined;

export interface SyncCssRuntime {
  parse(css: string, options?: ProcessOptions): Root;
  stringify(node: Node, builder: Builder): void;
}

const javascriptSyncCssRuntime: SyncCssRuntime = {
  parse: parseOwnedSync,
  stringify: (node, builder) => stringifyOwned(node, builder as never),
};
let syncCssRuntime = javascriptSyncCssRuntime;

/** Select the synchronous parser/stringifier used by AST helpers in this entry point. */
export function setSyncCssRuntime(runtime?: SyncCssRuntime): void {
  syncCssRuntime = runtime ?? javascriptSyncCssRuntime;
}

export function parseWithSyncCssRuntime(css: string, options?: ProcessOptions): Root {
  return syncCssRuntime.parse(css, options);
}

export function stringifyWithSyncCssRuntime(node: Node, builder: Builder): void {
  syncCssRuntime.stringify(node, builder);
}

function isNode(value: unknown): value is Node {
  return value instanceof Node;
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
      if (node.type) return 'nodes' in node ? new Container(node) : new Node(node);
      if ('prop' in node) {
        if (node.value === undefined) throw new Error('Value field is missed in node creation');
        return new Declaration(node as NodeInit & DeclarationDTO);
      }
      if ('selector' in node) return new Rule(node as ContainerInit & RuleDTO);
      if ('name' in node) return new AtRule(node as ContainerInit & AtRuleDTO);
      if ('text' in node) return new Comment(node as NodeInit & CommentDTO);
      if ('nodes' in node) return new Root(node);
      throw new Error('Unknown node type in node creation');
  }
}

function sourceOffset(
  inputCSS: string,
  position: { line?: number; column?: number; offset?: number } | undefined,
): number {
  if (position && typeof position.offset === 'number') return position.offset;
  if (!position?.line || !position.column) return 0;
  let column = 1;
  let line = 1;
  for (let i = 0; i < inputCSS.length; i++) {
    if (line === position.line && column === position.column) return i;
    if (inputCSS[i] === '\n') {
      column = 1;
      line += 1;
    } else {
      column += 1;
    }
  }
  return inputCSS.length;
}

function sourceInputText(node: Node): string | undefined {
  const input = node.source?.input as { css?: string; document?: string } | undefined;
  if (!input) return undefined;
  return typeof input.document === 'string' ? input.document : input.css;
}

function flattenNodeChildren(children: readonly NodeChild[]): Array<NodeInput | string> {
  const flattened: Array<NodeInput | string> = [];
  for (const child of children) {
    if (child === undefined) continue;
    if (Array.isArray(child)) {
      flattened.push(...flattenNodeChildren(child));
    } else {
      flattened.push(child as NodeInput | string);
    }
  }
  return flattened;
}

export class Node {
  type: NodeType;
  source?: SourceLocation;
  raws: Raws;
  private parentNode?: Container<any>;
  private clean = false;
  private proxyCache?: this;

  constructor(defaults?: NodeInit);
  constructor(type: NodeType, defaults?: NodeInit);
  constructor(typeOrDefaults: NodeType | NodeInit = {}, defaults: NodeInit = {}) {
    const init = typeof typeOrDefaults === 'string' ? defaults : typeOrDefaults;
    this.type = typeof typeOrDefaults === 'string' ? typeOrDefaults : (init.type ?? '');
    this.source = init.source;
    this.raws = cloneRaws(init.raws);
    for (const [name, value] of Object.entries(init)) {
      if (
        name === 'type' ||
        name === 'source' ||
        name === 'raws' ||
        name === 'nodes' ||
        name === 'selectors'
      ) {
        continue;
      }
      (this as unknown as Record<string, unknown>)[name] = value;
    }
  }

  get parent(): Container<any> | undefined {
    return this.parentNode;
  }

  set parent(parent: Container<any> | undefined) {
    this.parentNode = parent;
  }

  get proxyOf(): this {
    return this;
  }

  setParent(parent: Container<any> | undefined): void {
    this.parentNode = parent;
  }

  addToError<T extends Error>(error: T): T {
    Object.assign(error, { postcssNode: this });
    if (
      error.stack &&
      this.source &&
      /\n\s{4}at /.test(error.stack) &&
      this.source.file &&
      this.source.start
    ) {
      error.stack = error.stack.replace(
        /\n\s{4}at /,
        `$&${this.source.file}:${this.source.start.line}:${this.source.start.column}$&`,
      );
    }
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
    return this.parent.nodes?.[this.parent.index(this) + 1];
  }

  prev(): Node | undefined {
    if (!this.parent) return undefined;
    return this.parent.nodes?.[this.parent.index(this) - 1];
  }

  remove(): this {
    if (this.parent) this.parent.removeChild(this);
    return this;
  }

  replaceWith(...nodes: NodeChild[]): this {
    if (!this.parent) return this;

    let bookmark: Node | undefined;
    let foundSelf = false;

    for (const input of flattenNodeChildren(nodes)) {
      if (input === this) {
        foundSelf = true;
      } else if (foundSelf) {
        const parent = this.parent;
        const reference = bookmark ?? this;
        parent?.insertAfter(reference, input);
        if (parent) bookmark = parent.nodes?.[parent.index(reference) + 1];
      } else {
        this.parent?.insertBefore(this, input);
      }
    }

    if (!foundSelf) this.remove();

    return this;
  }

  clone(overrides: Record<string, unknown> = {}): this {
    const copy = cloneNode(this);
    Object.assign(copy, overrides);
    return copy;
  }

  cloneBefore(overrides: Record<string, unknown> = {}): this {
    const copy = this.clone(overrides);
    if (!this.parent) throw new Error('Cannot clone before a node without a parent');
    this.parent.insertBefore(this, copy);
    return copy;
  }

  cloneAfter(overrides: Record<string, unknown> = {}): this {
    const copy = this.clone(overrides);
    if (!this.parent) throw new Error('Cannot clone after a node without a parent');
    this.parent.insertAfter(this, copy);
    return copy;
  }

  before(...nodes: NodeChild[]): this {
    if (!this.parent) throw new Error('Cannot insert before a node without a parent');
    this.parent.insertBefore(this, ...nodes);
    return this;
  }

  after(...nodes: NodeChild[]): this {
    if (!this.parent) throw new Error('Cannot insert after a node without a parent');
    this.parent.insertAfter(this, ...nodes);
    return this;
  }

  cleanRaws(keepBetween = false): void {
    delete this.raws.before;
    delete this.raws.after;
    if (!keepBetween) delete this.raws.between;
  }

  get isClean(): boolean {
    return this.clean;
  }

  markClean(): this {
    this.clean = true;
    return this;
  }

  markDirty(): this {
    if (!this.clean) return this;
    this.clean = false;
    if (this.parent) this.parent.markDirty();
    return this;
  }

  raw(prop: string, defaultType?: string): boolean | string {
    const value = this.raws[prop];
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean') return value;
    if (value && typeof value === 'object' && !Array.isArray(value) && 'raw' in value) {
      return String(value.raw);
    }
    return defaultRaw(this, prop, defaultType);
  }

  positionInside(index: number): SourceLocation['start'] {
    const start = this.source?.start;
    if (!start) return { line: 1, column: index + 1, offset: index };
    const inputString = sourceInputText(this);
    if (!inputString) {
      return {
        line: start.line,
        column: start.column + index,
        offset: (start.offset ?? 0) + index,
      };
    }
    let column = start.column;
    let line = start.line;
    const offset = sourceOffset(inputString, start);
    const end = offset + index;
    for (let i = offset; i < end; i++) {
      if (inputString[i] === '\n') {
        column = 1;
        line += 1;
      } else {
        column += 1;
      }
    }
    return { column, line, offset: end };
  }

  positionBy(options: { index?: number; word?: string } = {}): SourceLocation['start'] {
    let pos = this.source?.start ?? this.positionInside(0);
    if (options.index) {
      pos = this.positionInside(options.index);
    } else if (options.word && this.source) {
      const inputString = sourceInputText(this);
      if (inputString && this.source.end) {
        const representation = inputString.slice(
          sourceOffset(inputString, this.source.start),
          sourceOffset(inputString, this.source.end),
        );
        const index = representation.indexOf(options.word);
        if (index !== -1) pos = this.positionInside(index);
      } else {
        const index = this.toText().indexOf(options.word);
        if (index >= 0) pos = this.positionInside(index);
      }
    }
    return pos;
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
    const inputString = sourceInputText(this) ?? '';
    let start: SourceLocation['start'] = this.source?.start
      ? {
          column: this.source.start.column,
          line: this.source.start.line,
          offset: sourceOffset(inputString, this.source.start),
        }
      : this.positionInside(0);
    let end: SourceLocation['end'] = this.source?.end
      ? {
          column: this.source.end.column + 1,
          line: this.source.end.line,
          offset:
            typeof this.source.end.offset === 'number'
              ? this.source.end.offset
              : sourceOffset(inputString, this.source.end) + 1,
        }
      : {
          column: start.column + 1,
          line: start.line,
          offset: (start.offset ?? 0) + 1,
        };

    if (options.word) {
      const representation = this.source?.end
        ? inputString.slice(
            sourceOffset(inputString, this.source.start),
            sourceOffset(inputString, this.source.end),
          )
        : this.toText();
      const index = representation.indexOf(options.word);
      if (index !== -1) {
        start = this.positionInside(index);
        end = this.positionInside(index + options.word.length);
      }
    } else {
      if (options.start) {
        start = {
          column: options.start.column,
          line: options.start.line,
          offset: sourceOffset(inputString, options.start),
        };
      } else if (options.index) {
        start = this.positionInside(options.index);
      }

      if (options.end) {
        end = {
          column: options.end.column,
          line: options.end.line,
          offset: sourceOffset(inputString, options.end),
        };
      } else if (typeof options.endIndex === 'number') {
        end = this.positionInside(options.endIndex);
      } else if (options.index) {
        end = this.positionInside(options.index + 1);
      }
    }

    if (end.line < start.line || (end.line === start.line && end.column <= start.column)) {
      end = {
        column: start.column + 1,
        line: start.line,
        offset: (start.offset ?? 0) + 1,
      };
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
    if (!this.source) {
      const error = new CssSyntaxError(message);
      error.postcssNode = this;
      return error;
    }
    const range = this.rangeBy(options);
    const input = this.source.input;
    const error =
      input && typeof input.error === 'function'
        ? input.error(
            message,
            { line: range.start.line, column: range.start.column },
            { line: range.end.line, column: range.end.column },
            options,
          )
        : new CssSyntaxError(
            message,
            { line: range.start.line, column: range.start.column },
            { line: range.end.line, column: range.end.column },
            typeof input?.css === 'string' ? input.css : undefined,
            this.source.file,
            options.plugin,
          );
    error.postcssNode = this;
    return error;
  }

  protected getProxyProcessor(): ProxyHandler<this> {
    return {
      get: (node, prop) => {
        if (prop === 'proxyOf') return node;
        if (prop === 'root') return () => node.root().toProxy();
        const value = Reflect.get(node, prop, node);
        if (typeof value === 'function') return value.bind(node);
        return value;
      },
      set: (node, prop, value) => {
        if (Reflect.get(node, prop, node) === value) return true;
        Reflect.set(node, prop, value, node);
        if (
          prop === 'prop' ||
          prop === 'value' ||
          prop === 'name' ||
          prop === 'params' ||
          prop === 'important' ||
          prop === 'text'
        ) {
          node.markDirty();
        }
        return true;
      },
    };
  }

  toProxy(): this {
    if (!this.proxyCache) {
      this.proxyCache = new Proxy(this, this.getProxyProcessor());
    }
    return this.proxyCache;
  }

  toString(stringifier: Stringifier | StringifierSyntax = defaultStringifier): string {
    const stringify = typeof stringifier === 'function' ? stringifier : stringifier.stringify;
    let result = '';
    stringify(this, (chunk) => {
      result += chunk;
    });
    return result;
  }

  warn(
    result: {
      messages?: Array<Record<string, unknown>>;
      lastPlugin?: { postcssPlugin?: string } | string;
    },
    text: string,
    options: { plugin?: string; index?: number; word?: string } = {},
  ): Record<string, unknown> {
    const lastPlugin =
      typeof result.lastPlugin === 'string' ? result.lastPlugin : result.lastPlugin?.postcssPlugin;
    const warning = new Warning(text, {
      plugin: options.plugin ?? lastPlugin,
      node: this,
      ...options,
    });
    (result.messages ??= []).push(warning);
    return warning;
  }

  protected jsonMeta(inputs: Map<unknown, number>): { source?: object; raws?: Raws } {
    const meta: { source?: object; raws?: Raws } = {};
    if (this.source !== undefined) {
      if (this.source.input) {
        let inputId = inputs.get(this.source.input);
        if (inputId === undefined) {
          inputId = inputs.size;
          inputs.set(this.source.input, inputId);
        }
        const { input: _input, file: _file, ...source } = this.source;
        meta.source = { ...source, inputId };
      } else {
        meta.source = { ...this.source };
      }
    }
    meta.raws = cloneRaws(this.raws);
    return meta;
  }

  protected jsonExtras(
    known: readonly string[],
    inputs?: Map<unknown, number>,
  ): Record<string, unknown> {
    const excluded = new Set(['type', 'source', 'raws', 'nodes', ...known]);
    const extras: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(this)) {
      if (excluded.has(name) || INTERNAL_NODE_PROPERTIES.has(name)) continue;
      extras[name] = serializeJSONValue(value, inputs);
    }
    return extras;
  }

  toJSON(_key?: unknown, inputs?: Map<unknown, number>): object {
    const sharedInputs = inputs ?? new Map<unknown, number>();
    const meta = this.jsonMeta(sharedInputs);
    return finishJSON(
      {
        ...meta,
        ...this.jsonExtras([], sharedInputs),
        type: this.type,
      },
      inputs,
      sharedInputs,
    );
  }
}

export class Container<Child extends Node = ChildNode> extends Node {
  nodes: Child[] | undefined;
  private lastEach = 0;
  private readonly indexes = new Map<number, number>();

  constructor(defaults?: ContainerInit);
  constructor(type: NodeType, defaults?: ContainerInit);
  constructor(typeOrDefaults: NodeType | ContainerInit = {}, defaults: ContainerInit = {}) {
    const type = typeof typeOrDefaults === 'string' ? typeOrDefaults : (typeOrDefaults.type ?? '');
    const init = typeof typeOrDefaults === 'string' ? defaults : typeOrDefaults;
    super(type, init);
    this.nodes = [];
    for (const child of init.nodes ?? []) {
      // Match PostCSS construction when adopting live parented nodes: clone so the
      // source tree stays intact. Detached nodes (fromJSON/bridge hydration) keep
      // their serialized raws instead of being re-normalized through append().
      if (child instanceof Node && child.parent) {
        this.append(child.clone());
      } else {
        for (const node of this.normalize([child as NodeChild], this.last, 'hydrate')) {
          this.nodes.push(node as Child);
        }
      }
    }
  }

  get first(): Child | undefined {
    return this.nodes?.[0];
  }
  get last(): Child | undefined {
    return this.nodes?.[this.nodes.length - 1];
  }

  protected getProxyProcessor(): ProxyHandler<this> {
    return {
      get: (node, prop) => {
        if (prop === 'proxyOf') return node;
        if (prop === 'root') return () => node.root().toProxy();
        if (prop === 'nodes') return node.nodes?.map((child) => child.toProxy());
        if (prop === 'first' || prop === 'last') {
          const child = Reflect.get(node, prop, node) as Node | undefined;
          return child?.toProxy();
        }
        if (prop === 'each' || (typeof prop === 'string' && prop.startsWith('walk'))) {
          return (...args: unknown[]) =>
            (Reflect.get(node, prop, node) as (...inner: unknown[]) => unknown).apply(
              node,
              args.map((arg) =>
                typeof arg === 'function'
                  ? (child: Node, index: number) =>
                      (arg as (child: Node, index: number) => unknown)(child.toProxy(), index)
                  : arg,
              ),
            );
        }
        if (prop === 'every' || prop === 'some') {
          return (callback: (child: Node, ...rest: unknown[]) => unknown) =>
            (Reflect.get(node, prop, node) as (cb: typeof callback) => unknown).call(
              node,
              (child: Node, ...rest: unknown[]) => callback(child.toProxy(), ...rest),
            );
        }
        const value = Reflect.get(node, prop, node);
        if (typeof value === 'function') return value.bind(node);
        return value;
      },
      set: (node, prop, value) => {
        if (Reflect.get(node, prop, node) === value) return true;
        Reflect.set(node, prop, value, node);
        if (prop === 'name' || prop === 'params' || prop === 'selector') {
          node.markDirty();
        }
        return true;
      },
    };
  }

  append(...children: NodeChild[]): this {
    this.nodes ??= [];
    let added = 0;
    for (const child of children) {
      const nodes = this.normalize([child], this.last);
      for (const node of nodes) this.nodes.push(node as Child);
      added += nodes.length;
    }
    if (added) this.markDirty();
    return this;
  }

  push(child: Child): this {
    this.nodes ??= [];
    child.parent = this;
    this.nodes.push(child);
    return this;
  }

  each(callback: WalkCallback<Child>): false | undefined {
    if (!this.nodes) return undefined;
    const iterator = ++this.lastEach;
    this.indexes.set(iterator, 0);
    let result: unknown;
    while ((this.indexes.get(iterator) ?? 0) < this.nodes.length) {
      const index = this.indexes.get(iterator) ?? 0;
      const child = this.nodes[index];
      result = callback(child, index);
      if (result === false) break;
      this.indexes.set(iterator, (this.indexes.get(iterator) ?? index) + 1);
    }
    this.indexes.delete(iterator);
    return result === false ? false : undefined;
  }

  prepend(...children: NodeChild[]): this {
    this.nodes ??= [];
    let added = 0;
    for (const child of [...children].reverse()) {
      const nodes = this.normalize([child], this.first, 'prepend').reverse();
      for (const node of nodes) this.nodes.unshift(node as Child);
      for (const [id, index] of this.indexes) this.indexes.set(id, index + nodes.length);
      added += nodes.length;
    }
    if (added) this.markDirty();
    return this;
  }

  insertBefore(existing: Node | number, ...children: NodeChild[]): this {
    const initialIndex = this.index(existing);
    if (typeof existing !== 'number' && initialIndex < 0) {
      throw new Error('Node is not a child of this container');
    }
    const sample = this.nodes?.[initialIndex];
    const nodes = this.normalize(children, sample, initialIndex === 0 ? 'prepend' : undefined);
    const index = typeof existing === 'number' ? initialIndex : this.index(existing);
    this.insertBeforeIndex(index, nodes, sample);
    return this;
  }

  insertAfter(existing: Node | number, ...children: NodeChild[]): this {
    const initialIndex = this.index(existing);
    if (typeof existing !== 'number' && initialIndex < 0) {
      throw new Error('Node is not a child of this container');
    }
    const sample = this.nodes?.[initialIndex];
    const nodes = this.normalize(children, sample);
    const index = typeof existing === 'number' ? initialIndex : this.index(existing);
    this.insertBeforeIndex(index + 1, nodes, sample);
    return this;
  }

  insertBeforeIndex(index: number, children: Node[], sample?: Node): void {
    const detached = children.filter(
      (node) => node.parent !== this || (this.nodes?.includes(node as Child) ?? false),
    );
    for (const node of detached) {
      if (node.parent) {
        if (node.parent instanceof Root) node.parent.removeChild(node, true);
        else node.parent.removeChild(node);
      }
    }
    if (detached.length) this.inheritBefore(detached, sample ?? this.nodes?.[index]);
    for (const node of detached) node.setParent(this);
    this.nodes?.splice(index, 0, ...(children as Child[]));
    for (const [id, iteratorIndex] of this.indexes) {
      if (index <= iteratorIndex) this.indexes.set(id, iteratorIndex + children.length);
    }
    if (children.length) this.markDirty();
  }

  protected normalize(children: readonly NodeChild[], sample?: Node, mode?: InsertMode): Node[] {
    const nodes = this.convert(children);
    for (const node of nodes) {
      if (node.parent) {
        if (node.parent instanceof Root) node.parent.removeChild(node, true);
        else node.parent.removeChild(node);
      }
    }
    this.inheritBefore(nodes, sample, mode);
    for (const node of nodes) node.setParent(this);
    return nodes;
  }

  private convert(children: readonly NodeChild[]): Node[] {
    const nodes: Node[] = [];
    for (const child of children) {
      if (child === undefined) continue;
      if (Array.isArray(child)) {
        // Copy first so moving live `parent.nodes` during construction does not skip siblings.
        nodes.push(...this.convert([...child]));
        continue;
      }
      if (typeof child === 'string') {
        const parsed = parseWithSyncCssRuntime(child);
        nodes.push(
          ...parsed.nodes.map((node) => {
            const json = node.toJSON() as unknown as AstDTO;
            removeSource(json);
            return asNode(json);
          }),
        );
        continue;
      }
      const node = asNode(child as NodeInput);
      if (this.type !== 'document' && node.type === 'root') {
        nodes.push(...[...((node as Root).nodes ?? [])]);
      } else {
        nodes.push(node);
      }
    }
    return nodes;
  }

  protected inheritBefore(
    nodes: readonly Node[],
    sample: Node | undefined,
    _mode?: InsertMode,
  ): void {
    if (!sample || sample.raws.before === undefined) return;
    const before = sample.raws.before.replace(/\S/g, '');
    for (const node of nodes) {
      if (node.raws.before === undefined) node.raws.before = before;
    }
  }

  removeChild(child: Node | number): this {
    const index = this.index(child);
    if (index < 0) throw new Error('Node is not a child of this container');
    this.nodes?.[index]?.setParent(undefined);
    this.nodes?.splice(index, 1);
    for (const [id, iteratorIndex] of this.indexes) {
      if (iteratorIndex >= index) this.indexes.set(id, iteratorIndex - 1);
    }
    this.markDirty();
    return this;
  }

  index(child: Node | number): number {
    if (typeof child === 'number') return child;
    return this.nodes?.indexOf(child.proxyOf as Child) ?? -1;
  }

  removeAll(): this {
    for (const node of this.nodes ?? []) node.setParent(undefined);
    this.nodes = [];
    this.markDirty();
    return this;
  }

  cleanRaws(keepBetween = false): void {
    super.cleanRaws(keepBetween);
    for (const node of this.nodes ?? []) node.cleanRaws(keepBetween);
  }

  replaceValues(pattern: string | RegExp, replacement: string): this;
  replaceValues(pattern: string | RegExp, callback: (...args: any[]) => string): this;
  replaceValues(
    pattern: string | RegExp,
    options: { props?: readonly string[]; fast?: string },
    callback: (...args: any[]) => string,
  ): this;
  replaceValues(
    pattern: string | RegExp,
    optionsOrReplacement:
      | string
      | { props?: readonly string[]; fast?: string }
      | ((...args: any[]) => string),
    maybeCallback?: (...args: any[]) => string,
  ): this {
    const options = typeof optionsOrReplacement === 'object' ? optionsOrReplacement : {};
    const replacement =
      typeof optionsOrReplacement === 'object' ? maybeCallback : optionsOrReplacement;
    if (replacement === undefined) throw new Error('replaceValues requires a replacement');
    this.walkDecls((decl) => {
      if (options.props && !options.props.includes(decl.prop)) return;
      if (options.fast && !decl.value.includes(options.fast)) return;
      decl.value =
        typeof replacement === 'string'
          ? decl.value.replace(pattern, replacement)
          : decl.value.replace(pattern as never, replacement as never);
    });
    return this;
  }

  some(callback: (node: Child, index: number, nodes: Child[]) => boolean): boolean {
    return this.nodes!.some(callback);
  }
  every(callback: (node: Child, index: number, nodes: Child[]) => boolean): boolean {
    return this.nodes!.every(callback);
  }

  walk(callback: WalkCallback): false | undefined {
    return this.each((child, index) => {
      let result: unknown;
      try {
        result = callback(child, index);
      } catch (error) {
        throw child.addToError(error instanceof Error ? error : new Error(String(error)));
      }
      if (
        result !== false &&
        'walk' in child &&
        typeof (child as Node & { walk?: unknown }).walk === 'function'
      ) {
        return (
          child as unknown as Node & {
            walk(callback: WalkCallback): false | undefined;
          }
        ).walk(callback);
      }
      return result;
    });
  }

  walkAtRules(
    nameOrCallback: string | RegExp | ((node: AtRule, index: number) => unknown),
    callback?: (node: AtRule, index: number) => unknown,
  ): false | undefined {
    const matches = (node: Node): boolean => {
      if (node.type !== 'atrule') return false;
      const atRule = node as AtRule;
      if (typeof nameOrCallback === 'function') return true;
      if (nameOrCallback instanceof RegExp) {
        nameOrCallback.lastIndex = 0;
        return nameOrCallback.test(atRule.name);
      }
      return atRule.name === nameOrCallback;
    };
    const visit = typeof nameOrCallback === 'function' ? nameOrCallback : callback;
    if (!visit) throw new Error('walkAtRules requires a callback');
    return this.walk((node, index) => (matches(node) ? visit(node as AtRule, index) : undefined));
  }

  walkComments(callback: WalkCallback<Comment>): false | undefined {
    return this.walk((node, index) =>
      node.type === 'comment' ? callback(node as Comment, index) : undefined,
    );
  }

  walkDecls(
    propOrCallback: string | RegExp | ((node: Declaration, index: number) => unknown),
    callback?: (node: Declaration, index: number) => unknown,
  ): false | undefined {
    const matches = (node: Node): boolean => {
      if (node.type !== 'decl') return false;
      const declaration = node as Declaration;
      if (typeof propOrCallback === 'function') return true;
      if (propOrCallback instanceof RegExp) {
        propOrCallback.lastIndex = 0;
        return propOrCallback.test(declaration.prop);
      }
      return declaration.prop === propOrCallback;
    };
    const visit = typeof propOrCallback === 'function' ? propOrCallback : callback;
    if (!visit) throw new Error('walkDecls requires a callback');
    return this.walk((node, index) =>
      matches(node) ? visit(node as Declaration, index) : undefined,
    );
  }

  walkRules(
    selectorOrCallback: string | RegExp | ((node: Rule, index: number) => unknown),
    callback?: (node: Rule, index: number) => unknown,
  ): false | undefined {
    const matches = (node: Node): boolean => {
      if (node.type !== 'rule') return false;
      const rule = node as Rule;
      if (typeof selectorOrCallback === 'function') return true;
      if (selectorOrCallback instanceof RegExp) {
        selectorOrCallback.lastIndex = 0;
        return selectorOrCallback.test(rule.selector);
      }
      return rule.selector === selectorOrCallback;
    };
    const visit = typeof selectorOrCallback === 'function' ? selectorOrCallback : callback;
    if (!visit) throw new Error('walkRules requires a callback');
    return this.walk((node, index) => (matches(node) ? visit(node as Rule, index) : undefined));
  }

  toJSON(_key?: unknown, inputs?: Map<unknown, number>): object {
    const sharedInputs = inputs ?? new Map<unknown, number>();
    const meta = this.jsonMeta(sharedInputs);
    return finishJSON(
      {
        ...meta,
        ...this.jsonExtras([], sharedInputs),
        type: this.type,
        nodes: (this.nodes ?? []).map((node) => node.toJSON(null, sharedInputs)),
      },
      inputs,
      sharedInputs,
    );
  }
}

export class Root extends Container<ChildNode> {
  declare nodes: ChildNode[];
  constructor(init: RootInit = {}) {
    super('root', init);
  }

  /**
   * A root has no indentation of its own, so children exchange `raws.before` when the first one
   * moves. Hydration keeps the serialized raws instead: unlike PostCSS, which only rebuilds a tree
   * from JSON in `fromJSON()`, every stylesheet crossing the Go bridge is rebuilt this way.
   */
  protected inheritBefore(
    nodes: readonly Node[],
    sample: Node | undefined,
    mode?: InsertMode,
  ): void {
    if (mode === 'hydrate') {
      super.inheritBefore(nodes, sample, mode);
      return;
    }
    if (!sample) return;
    if (mode === 'prepend') {
      if (this.nodes.length > 1 && this.nodes[1].raws.before !== undefined) {
        sample.raws.before = this.nodes[1].raws.before;
      } else {
        delete sample.raws.before;
      }
      return;
    }
    if (this.first !== sample) {
      for (const node of nodes) {
        if (sample.raws.before === undefined) delete node.raws.before;
        else node.raws.before = sample.raws.before;
      }
    }
  }

  removeChild(child: Node | number, ignore = false): this {
    const index = this.index(child);
    if (!ignore && index === 0 && this.nodes.length > 1) {
      this.nodes[1].raws.before = this.nodes[index].raws.before;
    }
    return super.removeChild(index);
  }

  async toResult(options: ProcessOptions = {}, service?: PostcssGoService) {
    const { toResult } = await import('./api.js');
    return toResult(this, options, service);
  }
  toJSON(_key?: unknown, inputs?: Map<unknown, number>): RootDTO {
    const sharedInputs = inputs ?? new Map<unknown, number>();
    const meta = this.jsonMeta(sharedInputs);
    return finishJSON(
      {
        ...meta,
        ...this.jsonExtras([], sharedInputs),
        type: 'root',
        nodes: this.nodes.map((node) => node.toJSON(null, sharedInputs) as AstDTO),
      },
      inputs,
      sharedInputs,
    ) as unknown as RootDTO;
  }
}

export class Document extends Container<Root> {
  declare nodes: Root[];
  constructor(init: DocumentInit = {}) {
    super('document', init);
  }

  async toResult(options: ProcessOptions = {}, service?: PostcssGoService) {
    const { toResult } = await import('./api.js');
    return toResult(this, options, service);
  }

  toJSON(_key?: unknown, inputs?: Map<unknown, number>): DocumentDTO {
    const sharedInputs = inputs ?? new Map<unknown, number>();
    return finishJSON(
      {
        ...this.jsonExtras([], sharedInputs),
        type: 'document',
        nodes: this.nodes.map((node) => node.toJSON(null, sharedInputs)) as RootDTO[],
        ...this.jsonMeta(sharedInputs),
      },
      inputs,
      sharedInputs,
    ) as unknown as DocumentDTO;
  }
}

export class Rule extends Container<ChildNode> {
  declare nodes: ChildNode[];
  selector: string;
  constructor(init: RuleInit = {}) {
    super('rule', init);
    this.selector = String(init.selector ?? '');
    if (init.selectors) this.selectors = [...init.selectors];
  }
  get selectors(): string[] {
    return list.comma(this.selector);
  }
  set selectors(values: string[]) {
    const match = this.selector ? this.selector.match(/,\s*/) : null;
    const sep = match ? match[0] : `,${String(this.raw('between', 'beforeOpen'))}`;
    this.selector = values.join(sep);
  }
  toJSON(_key?: unknown, inputs?: Map<unknown, number>): RuleDTO {
    const sharedInputs = inputs ?? new Map<unknown, number>();
    const meta = this.jsonMeta(sharedInputs);
    return finishJSON(
      {
        ...meta,
        ...this.jsonExtras(['selector'], sharedInputs),
        selector: this.selector,
        type: 'rule',
        nodes: this.nodes.map((node) => node.toJSON(null, sharedInputs) as AstDTO),
      },
      inputs,
      sharedInputs,
    ) as unknown as RuleDTO;
  }
}

export class AtRule extends Container<ChildNode> {
  declare nodes: ChildNode[] | undefined;
  name: string;
  params: string;
  /** True when this at-rule has a `{}` block, including empty blocks. */
  block: boolean;

  constructor(init: AtRuleInit = {}) {
    const dto = init;
    const explicitBlock = dto.block === true || Object.prototype.hasOwnProperty.call(init, 'nodes');
    super('atrule', init);
    this.name = String(dto.name ?? '');
    this.params = String(dto.params ?? '');
    this.block = explicitBlock;
    if (!explicitBlock) this.nodes = undefined;
  }

  get hasBlock(): boolean {
    return this.block || (this.nodes?.length ?? 0) > 0;
  }

  append(...children: NodeChild[]): this {
    this.block = true;
    return super.append(...children);
  }

  prepend(...children: NodeChild[]): this {
    this.block = true;
    return super.prepend(...children);
  }

  toJSON(_key?: unknown, inputs?: Map<unknown, number>): AtRuleDTO {
    const sharedInputs = inputs ?? new Map<unknown, number>();
    return finishJSON(
      {
        ...this.jsonExtras(['block', 'name', 'params'], sharedInputs),
        type: 'atrule',
        name: this.name,
        params: this.params,
        ...(this.hasBlock
          ? { nodes: (this.nodes ?? []).map((node) => node.toJSON(null, sharedInputs) as AstDTO) }
          : {}),
        ...this.jsonMeta(sharedInputs),
      },
      inputs,
      sharedInputs,
    ) as unknown as AtRuleDTO;
  }
}

export class Declaration extends Node {
  prop: string;
  value: string;
  important: boolean;
  constructor(init: DeclarationInit = {}) {
    super('decl', init);
    this.prop = String(init.prop ?? '');
    this.value = String(init.value ?? '');
    this.important = Boolean(init.important);
  }
  get variable(): boolean {
    return this.prop.startsWith('--') || this.prop.startsWith('$');
  }
  toJSON(_key?: unknown, inputs?: Map<unknown, number>): DeclarationDTO {
    const sharedInputs = inputs ?? new Map<unknown, number>();
    const meta = this.jsonMeta(sharedInputs);
    return finishJSON(
      {
        ...meta,
        ...this.jsonExtras(['important', 'prop', 'value'], sharedInputs),
        prop: this.prop,
        value: this.value,
        ...(this.important ? { important: true } : {}),
        type: 'decl',
      },
      inputs,
      sharedInputs,
    ) as unknown as DeclarationDTO;
  }
}

export class Comment extends Node {
  text: string;
  constructor(init: CommentInit = {}) {
    super('comment', init);
    this.text = String(init.text ?? '');
  }
  toJSON(_key?: unknown, inputs?: Map<unknown, number>): CommentDTO {
    const sharedInputs = inputs ?? new Map<unknown, number>();
    const meta = this.jsonMeta(sharedInputs);
    return finishJSON(
      {
        ...meta,
        ...this.jsonExtras(['text'], sharedInputs),
        text: this.text,
        type: 'comment',
      },
      inputs,
      sharedInputs,
    ) as unknown as CommentDTO;
  }
}

export type NodeFromJSON<T> = T extends DocumentDTO
  ? Document
  : T extends RootDTO
    ? Root
    : T extends RuleDTO
      ? Rule
      : T extends AtRuleDTO
        ? AtRule
        : T extends DeclarationDTO
          ? Declaration
          : T extends CommentDTO
            ? Comment
            : T extends readonly (infer Child)[]
              ? NodeFromJSON<Child>[]
              : Node;

export function fromAst<T extends AstDTO>(node: T): NodeFromJSON<T> {
  return asNode(node) as NodeFromJSON<T>;
}

/** Top-level trees returned by public parse/process APIs. */
export type ProcessRoot = Root | Document;

/** Coerce a DTO or live node into a Root/Document, rejecting other types. */
export function asProcessRoot(value: Node | AstDTO): ProcessRoot {
  const node = value instanceof Node ? value : fromAst(value);
  if (node instanceof Root || node instanceof Document) return node;
  throw new Error('postcss-go expected a Root or Document node');
}

/** Rehydrate a serialized PostCSS-shaped AST, including arrays of nodes. */
export function fromJSON<T extends AstDTO | readonly AstDTO[]>(value: T): NodeFromJSON<T>;
export function fromJSON(value: readonly object[]): Node[];
export function fromJSON(value: object): Node;
export function fromJSON(value: object | readonly object[]): Node | Node[] {
  return hydrateJSON(value);
}

export function toAst(node: Node): AstDTO {
  const inputs = new Map<unknown, number>();
  const ast = node.toJSON(null, inputs) as AstDTO;
  restoreBridgeSources(ast, [...inputs.keys()]);
  markBridgeBlocks(ast);
  return ast;
}

function defaultStringifier(node: Node, builder: Builder): void {
  stringifyWithSyncCssRuntime(node, builder);
}

function hydrateJSON(
  value: object | readonly object[],
  inheritedInputs?: readonly unknown[],
): Node | Node[] {
  if (Array.isArray(value)) {
    return (value as readonly object[]).map((node) => hydrateJSON(node, inheritedInputs) as Node);
  }
  const json = value as NodeInit & {
    inputs?: readonly unknown[];
    nodes?: readonly object[];
    source?: SourceLocation & { inputId?: number };
  };
  const inputs = json.inputs ? json.inputs.map(hydrateInput) : inheritedInputs;
  const { inputs: _ownInputs, ...defaults } = json;
  if (json.nodes) defaults.nodes = json.nodes.map((child) => hydrateJSON(child, inputs) as Node);
  if (json.source) {
    const { inputId, ...source } = json.source;
    defaults.source =
      inputId === undefined ? source : ({ ...source, input: inputs?.[inputId] } as SourceLocation);
  }
  return asNode(defaults);
}

function cloneNode<T extends Node>(node: T, parent?: Container<any>): T {
  const cloned = Object.create(Object.getPrototypeOf(node)) as T;
  for (const [name, value] of Object.entries(node)) {
    if (
      name === 'indexes' ||
      name === 'lastEach' ||
      name === 'proxyCache' ||
      name === 'parentNode'
    ) {
      continue;
    }
    if (name === 'source') {
      (cloned as unknown as Record<string, unknown>)[name] = value;
    } else if (name === 'nodes' && Array.isArray(value)) {
      (cloned as unknown as { nodes: Node[] }).nodes = value.map((child) =>
        cloneNode(child as Node, cloned as unknown as Container<any>),
      );
    } else {
      (cloned as unknown as Record<string, unknown>)[name] = cloneValue(value);
    }
  }
  if (node instanceof Container) {
    Object.assign(cloned, { indexes: new Map<number, number>(), lastEach: 0 });
  }
  cloned.setParent(parent);
  return cloned;
}
