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
  HANDLE_FIELD_IMPORTANT,
  HANDLE_FIELD_NAME,
  HANDLE_FIELD_PARAMS,
  HANDLE_FIELD_PROP,
  HANDLE_FIELD_SELECTOR,
  HANDLE_FIELD_TEXT,
  HANDLE_FIELD_VALUE,
  HandleDeclarationUnsupportedError,
  NativeHandleSession,
  type HandleField,
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

type PendingPatch = { id: number; field: HandleField; value: string };

const prototypes = {
  root: Root.prototype,
  document: Document.prototype,
  rule: Rule.prototype,
  atrule: AtRule.prototype,
  decl: Declaration.prototype,
  comment: Comment.prototype,
};

const SCALAR_FIELDS: Record<string, Partial<Record<string, HandleField>>> = {
  decl: {
    prop: HANDLE_FIELD_PROP,
    value: HANDLE_FIELD_VALUE,
    important: HANDLE_FIELD_IMPORTANT,
  },
  rule: { selector: HANDLE_FIELD_SELECTOR },
  atrule: { name: HANDLE_FIELD_NAME, params: HANDLE_FIELD_PARAMS },
  comment: { text: HANDLE_FIELD_TEXT },
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

function encodeScalar(key: string, value: unknown): { local: unknown; wire: string } {
  if (key === 'important') {
    const local = Boolean(value);
    return { local, wire: local ? '1' : '0' };
  }
  const local = String(value);
  return { local, wire: local };
}

export type SessionOwnerOptions = NativeHandleParseOptions & {
  /** When true, standard scalar fields accept ordered callback-local writes. */
  mutableScalars?: boolean;
};

/** One owner and wrapper cache per Go arena. Every retained wrapper retains this owner. */
export class SessionOwner {
  readonly session: NativeHandleSession;
  readonly mutableScalars: boolean;
  private readonly snapshots = new Map<number, Snapshot>();
  private readonly wrappers = new Map<number, Node>();
  private readonly input: Input;
  private readonly readCache = new WeakMap<object, object>();
  private readonly targets = new WeakMap<Node, Node>();
  private pending: PendingPatch[] = [];

  constructor(addon: NativeHandleAddon, css: string, options: SessionOwnerOptions = {}) {
    this.mutableScalars = options.mutableScalars === true;
    this.session = new NativeHandleSession(addon);
    this.input = new Input(css, { ...options, map: false });
    this.input.fromOffset(0); // Initialize the Input's read cache before protecting it.
    this.input = immutable(this.input, this.readCache);
    try {
      this.session.parse(this.input.css, {
        from: options.from,
        document: options.document,
        trackSource: true,
      });
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
    if (!this.targets.has(node)) throw new Error('foreign handle wrapper');
    Node.prototype.markClean.call(node);
  }

  /** Flush one ordered, mixed-field patch transaction for the current callback. */
  flushPatches(): void {
    if (this.pending.length === 0) return;
    const patches = this.pending;
    this.pending = [];
    const handles = new Uint32Array(patches.length);
    const fields = new Int32Array(patches.length);
    const values = new Array<string>(patches.length);
    for (let i = 0; i < patches.length; i++) {
      handles[i] = patches[i].id;
      fields[i] = patches[i].field;
      values[i] = patches[i].value;
    }
    this.session.applyPatches(handles, fields, values);
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
      if (typeof key === 'symbol') return Reflect.get(target, key);
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
    const writeScalar = (key: string, value: unknown): boolean => {
      if (!this.mutableScalars) return unsupported(key);
      const field = SCALAR_FIELDS[row.type]?.[key];
      if (field === undefined) return unsupported(key);
      const encoded = encodeScalar(key, value);
      if (Reflect.get(target, key) === encoded.local) return true;
      Reflect.set(target, key, encoded.local);
      if (key === 'prop') row.prop = encoded.local as string;
      if (key === 'value') row.value = encoded.local as string;
      if (key === 'important') row.important = encoded.local as boolean;
      if (key === 'selector') row.selector = encoded.local as string;
      if (key === 'name') row.name = encoded.local as string;
      if (key === 'params') row.params = encoded.local as string;
      if (key === 'text') row.text = encoded.local as string;
      this.pending.push({ id, field, value: encoded.wire });
      Node.prototype.markDirty.call(wrapper);
      return true;
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
        if (typeof key === 'symbol') return Reflect.getOwnPropertyDescriptor(target, key);
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        return descriptor ? { ...descriptor, value: read(key) } : undefined;
      },
      set: (_target, key, value) => {
        if (typeof key === 'symbol') return Reflect.set(target, key, value);
        if (typeof key !== 'string') return unsupported(key);
        return writeScalar(key, value);
      },
      deleteProperty: (_target, key) => unsupported(key),
      defineProperty: (_target, key, descriptor) => {
        if (typeof key === 'symbol') return Reflect.defineProperty(target, key, descriptor);
        return unsupported(key);
      },
      setPrototypeOf: () => unsupported('prototype'),
      preventExtensions: () => unsupported('preventExtensions'),
    });
    protectedObjects.add(wrapper);
    this.wrappers.set(id, wrapper);
    this.targets.set(wrapper, target);
    return wrapper;
  }
}
