import {
  AtRule,
  Comment,
  Declaration,
  Document,
  Node,
  Root,
  Rule,
  type ProcessRoot,
} from './ast.js';
import { Input } from './input.js';
import {
  HandleDeclarationUnsupportedError,
  NativeHandleSession,
  type NativeHandleAddon,
  type NativeHandleParseOptions,
} from './handle-session.js';

type Snapshot = {
  id: number;
  type: 'root' | 'document' | 'rule' | 'atrule' | 'decl' | 'comment';
  parent: number;
  nodes?: number[];
  block?: boolean;
  prop?: string;
  value?: string;
  selector?: string;
  name?: string;
  params?: string;
  text?: string;
  important?: boolean;
  raws: Node['raws'];
  source?: NonNullable<Node['source']>;
};
const prototypes = {
  root: Root.prototype,
  document: Document.prototype,
  rule: Rule.prototype,
  atrule: AtRule.prototype,
  decl: Declaration.prototype,
  comment: Comment.prototype,
};
const unsupported = (key: PropertyKey): never => {
  throw new HandleDeclarationUnsupportedError(String(key));
};

const protectedObjects = new WeakSet<object>();

/** Protect snapshots, including reflection and nested array/raw writes. */
function immutable<T extends object>(value: T, cache: WeakMap<object, object>): T {
  if (protectedObjects.has(value)) return value;
  const known = cache.get(value);
  if (known) return known as T;
  const proxy = new Proxy(value, {
    get(target, key, receiver) {
      const child: unknown = Reflect.get(target, key, receiver);
      return child && typeof child === 'object' ? immutable(child, cache) : child;
    },
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      if (
        descriptor &&
        'value' in descriptor &&
        descriptor.value &&
        typeof descriptor.value === 'object'
      )
        descriptor.value = immutable(descriptor.value, cache);
      return descriptor;
    },
    set: (_target, key) => unsupported(key),
    deleteProperty: (_target, key) => unsupported(key),
    defineProperty: (_target, key) => unsupported(key),
    setPrototypeOf: () => unsupported('prototype'),
    preventExtensions: () => unsupported('preventExtensions'),
  });
  cache.set(value, proxy);
  protectedObjects.add(proxy);
  return proxy;
}

/** One owner and wrapper cache per Go arena. Every retained wrapper retains this owner. */
export class SessionOwner {
  readonly session: NativeHandleSession;
  private readonly snapshots = new Map<number, Snapshot>();
  private readonly wrappers = new Map<number, Node>();
  private readonly input: Input;
  private readonly readCache = new WeakMap<object, object>();
  private readonly targets = new WeakMap<Node, Node>();

  constructor(addon: NativeHandleAddon, css: string, options: NativeHandleParseOptions = {}) {
    this.session = new NativeHandleSession(addon);
    this.input = new Input(css, { ...options, map: false });
    this.input.fromOffset(0); // Initialize the Input's read cache before protecting it.
    this.input = immutable(this.input, this.readCache);
    try {
      this.session.parse(this.input.css, { ...options, trackSource: true });
      for (const ids of this.session.nodeBatches()) {
        const rows = JSON.parse(this.session.readSnapshots(ids)) as Snapshot[];
        if (!Array.isArray(rows) || rows.length !== ids.length)
          throw new Error('invalid snapshot page');
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (
            row.id !== ids[i] ||
            !Object.hasOwn(prototypes, row.type) ||
            this.snapshots.has(row.id)
          )
            throw new Error('invalid snapshot identity');
          this.snapshots.set(row.id, row);
        }
      }
    } catch (error) {
      this.session.close();
      throw error;
    }
  }

  get root(): ProcessRoot {
    return this.node(this.session.rootHandle) as ProcessRoot;
  }

  /** Runtime bookkeeping is separate from immutable Go node data. */
  markClean(node: Node): void {
    const target = this.targets.get(node);
    if (!target) throw new Error('foreign handle wrapper');
    Node.prototype.markClean.call(target);
  }

  node(id: number): Node {
    const known = this.wrappers.get(id);
    if (known) return known;
    const row = this.snapshots.get(id);
    if (!row) throw new Error('invalid snapshot relationship');
    const target = Object.create(prototypes[row.type]) as Node;
    let source: Node['source'];
    let raws: Node['raws'] | undefined;
    const fields: Record<string, unknown> = {
      type: row.type,
      source: undefined,
      raws: undefined,
    };
    if (row.type === 'rule') fields.selector = row.selector ?? '';
    if (row.type === 'atrule')
      Object.assign(fields, {
        name: row.name ?? '',
        params: row.params ?? '',
      });
    if (['root', 'document', 'rule', 'atrule'].includes(row.type)) fields.nodes = undefined;
    if (row.type === 'atrule') fields.block = row.block ?? false;
    if (row.type === 'decl')
      Object.assign(fields, {
        prop: row.prop ?? '',
        value: row.value ?? '',
        important: row.important ?? false,
      });
    if (row.type === 'comment') fields.text = row.text ?? '';
    if (row.parent) fields.parent = undefined;
    Object.assign(target, fields);
    let children: Node[] | undefined;
    const read = (key: PropertyKey): unknown => {
      if (key === 'source') {
        if (!row.source) return undefined;
        return (source ??= immutable(
          {
            ...row.source,
            ...(row.parent === 0
              ? {
                  ...(this.input.css ? { css: this.input.css } : {}),
                  ...(this.input.file ? { mapUrl: this.input.file } : {}),
                }
              : {}),
            input: this.input,
          },
          this.readCache,
        ));
      }
      if (key === 'raws') return (raws ??= immutable(row.raws ?? {}, this.readCache));

      if (key === 'parent' && row.parent) return this.node(row.parent);
      if (key === 'nodes' && Object.hasOwn(fields, 'nodes')) {
        if (row.type === 'atrule' && !row.block) return undefined;
        return (children ??= immutable(
          (row.nodes ?? []).map((child) => this.node(child)),
          this.readCache,
        ));
      }
      return Reflect.get(target, key, wrapper);
    };
    const wrapper = new Proxy(target, {
      get: (_target, key) => {
        if (key === 'toProxy') return () => wrapper;
        if (key === 'toString')
          return (stringifier?: Parameters<Node['toString']>[0]) =>
            stringifier === undefined
              ? this.session.stringify(id)
              : Node.prototype.toString.call(wrapper, stringifier);
        if (key === 'each')
          return (callback: (node: Node, index: number) => unknown) => {
            const nodes = read('nodes') as Node[] | undefined;
            for (let i = 0; i < (nodes?.length ?? 0); i++)
              if (callback(nodes![i], i) === false) return false;
            return undefined;
          };
        return read(key);
      },
      getOwnPropertyDescriptor: (_target, key) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        return descriptor ? { ...descriptor, value: read(key) } : undefined;
      },
      set: (_target, key) => unsupported(key),
      deleteProperty: (_target, key) => unsupported(key),
      defineProperty: (_target, key) => unsupported(key),
      setPrototypeOf: () => unsupported('prototype'),
      preventExtensions: () => unsupported('preventExtensions'),
    });
    protectedObjects.add(wrapper);
    this.wrappers.set(id, wrapper);
    this.targets.set(wrapper, target);
    return wrapper;
  }
}
