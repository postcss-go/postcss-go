import {
  AtRule,
  Comment,
  Declaration,
  Document,
  Node,
  Root,
  Rule,
  type NodeChild,
  type ProcessRoot,
} from './ast.js';
import { Input } from './input.js';
import { list } from './list.js';
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
import type { ProcessOptions } from './types.js';

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

const STRUCTURAL_METHODS = new Set([
  'append',
  'prepend',
  'insertBefore',
  'insertAfter',
  'remove',
  'replaceWith',
  'clone',
  'cloneBefore',
  'cloneAfter',
  'before',
  'after',
  'removeAll',
  'removeChild',
]);

const unsupported = (key: PropertyKey): never => {
  throw new HandleDeclarationUnsupportedError(String(key));
};

const protectedObjects = new WeakSet<object>();
const wrapperOwners = new WeakMap<Node, SessionOwner>();

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

function flattenChildren(children: readonly NodeChild[]): unknown[] {
  const out: unknown[] = [];
  for (const child of children) {
    if (child === undefined) continue;
    if (Array.isArray(child)) out.push(...flattenChildren(child));
    else out.push(child);
  }
  return out;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export type SessionOwnerOptions = NativeHandleParseOptions & {
  /** When true, standard scalar fields accept ordered callback-local writes. */
  mutableScalars?: boolean;
  /** When true, parent/nodes/raws and structural methods stay live against Go. */
  mutableStructure?: boolean;
  /** Process map options so Input can attach PreviousMap for composition. */
  map?: ProcessOptions['map'];
};

export type HandleDiagnostics = {
  planReason: string;
  hydration: boolean;
  visits: number;
  runtime?: string;
};

/** One owner and wrapper cache per Go arena. Every retained wrapper retains this owner. */
export class SessionOwner {
  readonly session: NativeHandleSession;
  readonly mutableScalars: boolean;
  readonly mutableStructure: boolean;
  readonly diagnostics: HandleDiagnostics = {
    planReason: '',
    hydration: false,
    visits: 0,
  };
  private readonly addon: NativeHandleAddon;
  private readonly snapshots = new Map<number, Snapshot>();
  private readonly wrappers = new Map<number, Node>();
  private readonly handleIds = new WeakMap<Node, number>();
  private readonly childrenCache = new Map<number, Node[]>();
  private readonly rawsCache = new Map<number, Node['raws']>();
  private readonly input: Input;
  private readonly readCache = new WeakMap<object, object>();
  private readonly targets = new WeakMap<Node, Node>();
  private pending: PendingPatch[] = [];

  constructor(addon: NativeHandleAddon, css: string, options: SessionOwnerOptions = {}) {
    this.addon = addon;
    this.mutableStructure = options.mutableStructure === true;
    this.mutableScalars = options.mutableScalars === true || this.mutableStructure;
    this.session = new NativeHandleSession(addon);
    // Keep map options so PreviousMap attaches for previous-map composition.
    this.input = new Input(css, {
      from: options.from,
      document: options.document,
      map: options.map,
    });
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

  handleId(node: Node): number | undefined {
    return this.handleIds.get(node);
  }

  node(id: number): Node {
    const known = this.wrappers.get(id);
    if (known) return known;
    this.ensureSnapshot(id);
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
      if (key === 'raws') {
        if (this.mutableStructure) return this.trackedRaws(id, row);
        return (raws ??= immutable(row.raws ?? {}, this.readCache));
      }
      if (key === 'parent') {
        const parentId = this.mutableStructure ? this.session.parent(id) : row.parent;
        return parentId ? this.node(parentId) : undefined;
      }
      if (key === 'nodes' && Object.hasOwn(fields, 'nodes')) {
        if (row.type === 'atrule' && !row.block && !this.mutableStructure) return undefined;
        if (this.mutableStructure) {
          if (row.type === 'atrule') {
            const live = this.liveNodes(id);
            if (live.length === 0 && !row.block) return undefined;
            return live;
          }
          return this.liveNodes(id);
        }
        return this.frozenNodes(id, row);
      }
      if (key === 'selectors' && row.type === 'rule') {
        return list.comma(String(Reflect.get(target, 'selector') ?? ''));
      }
      return Reflect.get(target, key, wrapper);
    };
    const writeStructural = (key: string, value: unknown): boolean => {
      if (!this.mutableStructure) return unsupported(key);
      if (key === 'nodes') {
        if (value == null) {
          (this.structuralMethod(id, 'removeAll') as () => Node)();
          return true;
        }
        if (!Array.isArray(value)) return unsupported(key);
        (this.structuralMethod(id, 'removeAll') as () => Node)();
        for (const child of this.expandChildren(value as NodeChild[])) {
          this.session.append(id, this.materialize(child));
        }
        this.afterStructure(id);
        return true;
      }
      if (key === 'parent') {
        if (value == null) {
          const parent = this.session.parent(id);
          if (parent) {
            this.session.remove(id);
            this.invalidate(id);
            this.invalidate(parent);
            Node.prototype.markDirty.call(this.node(id));
            Node.prototype.markDirty.call(this.node(parent));
          }
          return true;
        }
        return unsupported(key);
      }
      return unsupported(key);
    };
    const writeScalar = (key: string, value: unknown): boolean => {
      if (key === 'nodes' || key === 'parent') return writeStructural(key, value);
      if (!this.mutableScalars) return unsupported(key);
      if (key === 'selectors' && row.type === 'rule') {
        const values = Array.isArray(value) ? value.map(String) : [String(value)];
        const match = String(Reflect.get(target, 'selector') ?? '').match(/,\s*/);
        const sep = match ? match[0] : ',';
        return writeScalar('selector', values.join(sep));
      }
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
        if (key === 'each') return this.makeEach(id, read);
        if (typeof key === 'string' && STRUCTURAL_METHODS.has(key)) {
          if (!this.mutableStructure) return unsupported(key);
          return this.structuralMethod(id, key);
        }
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
    this.handleIds.set(wrapper, id);
    wrapperOwners.set(wrapper, this);
    return wrapper;
  }

  private makeEach(id: number, read: (key: PropertyKey) => unknown) {
    return (callback: (node: Node, index: number) => unknown) => {
      let index = 0;
      for (;;) {
        const nodes = read('nodes') as Node[] | undefined;
        if (!nodes || index >= nodes.length) return undefined;
        const child = nodes[index];
        if (callback(child, index) === false) return false;
        // Prefer O(1) advance when the child is still at the same slot; fall back
        // to indexOf only after structural mutation moved or removed it.
        const nextNodes = read('nodes') as Node[] | undefined;
        if (!nextNodes) return undefined;
        if (nextNodes[index] === child) {
          index += 1;
        } else {
          const next = nextNodes.indexOf(child);
          index = next === -1 ? index : next + 1;
        }
      }
    };
  }

  private frozenNodes(id: number, row: Snapshot): Node[] {
    const known = this.childrenCache.get(id);
    if (known) return known;
    const children = immutable(
      (row.nodes ?? []).map((child) => this.node(child)),
      this.readCache,
    );
    this.childrenCache.set(id, children);
    return children;
  }

  private liveNodes(id: number): Node[] {
    const known = this.childrenCache.get(id);
    if (known) return known;
    const count = this.session.childCount(id);
    const children: Node[] = [];
    for (let i = 0; i < count; i++) children.push(this.node(this.session.childAt(id, i)));
    this.childrenCache.set(id, children);
    return children;
  }

  private trackedRaws(id: number, row: Snapshot): Node['raws'] {
    const known = this.rawsCache.get(id);
    if (known) return known;
    const local = { ...(row.raws ?? {}) } as Record<string, unknown>;
    const proxy = new Proxy(local, {
      get: (target, key, receiver) => Reflect.get(target, key, receiver),
      set: (target, key, value) => {
        if (typeof key !== 'string') return Reflect.set(target, key, value);
        Reflect.set(target, key, value);
        row.raws = target as Node['raws'];
        if (value === undefined) {
          this.session.setRaw(id, { key, kind: 'delete' });
        } else if (typeof value === 'boolean') {
          this.session.setRaw(id, { key, kind: 'bool', value });
        } else if (isPlainRecord(value) && ('value' in value || 'raw' in value)) {
          this.session.setRaw(id, { key, kind: 'value', value });
        } else {
          this.session.setRaw(id, { key, kind: 'string', value: String(value) });
        }
        Node.prototype.markDirty.call(this.node(id));
        return true;
      },
      deleteProperty: (target, key) => {
        if (typeof key !== 'string') return Reflect.deleteProperty(target, key);
        Reflect.deleteProperty(target, key);
        row.raws = target as Node['raws'];
        this.session.setRaw(id, { key, kind: 'delete' });
        Node.prototype.markDirty.call(this.node(id));
        return true;
      },
    }) as Node['raws'];
    this.rawsCache.set(id, proxy);
    return proxy;
  }

  private structuralMethod(id: number, name: string) {
    const move = (childId: number, apply: () => void): void => {
      const oldParent = this.session.parent(childId);
      apply();
      if (oldParent && oldParent !== id) this.invalidate(oldParent);
    };
    switch (name) {
      case 'append':
        return (...children: NodeChild[]) => {
          for (const child of this.expandChildren(children)) {
            const childId = this.materialize(child);
            move(childId, () => this.session.append(id, childId));
          }
          return this.afterStructure(id);
        };
      case 'prepend':
        return (...children: NodeChild[]) => {
          for (const child of this.expandChildren(children).reverse()) {
            const childId = this.materialize(child);
            move(childId, () => this.session.prepend(id, childId));
          }
          return this.afterStructure(id);
        };
      case 'insertBefore':
        return (existing: Node | number, ...children: NodeChild[]) => {
          const target = this.resolveChild(id, existing);
          for (const child of this.expandChildren(children)) {
            const childId = this.materialize(child);
            move(childId, () => this.session.insertBefore(target, childId));
          }
          return this.afterStructure(id);
        };
      case 'insertAfter':
        return (existing: Node | number, ...children: NodeChild[]) => {
          let target = this.resolveChild(id, existing);
          for (const child of this.expandChildren(children)) {
            const childId = this.materialize(child);
            move(childId, () => this.session.insertAfter(target, childId));
            target = childId;
          }
          return this.afterStructure(id);
        };
      case 'remove':
        return () => {
          const parent = this.session.parent(id);
          if (parent) {
            const parentRow = this.snapshots.get(parent);
            // Root#removeChild transfers the first child's before onto the next sibling.
            if (parentRow?.type === 'root') {
              const count = this.session.childCount(parent);
              if (count > 1 && this.session.childAt(parent, 0) === id) {
                const next = this.session.childAt(parent, 1);
                const before = this.node(id).raws.before;
                if (before === undefined) delete this.node(next).raws.before;
                else this.node(next).raws.before = before;
              }
            }
          }
          this.session.remove(id);
          this.invalidate(id);
          if (parent) this.invalidate(parent);
          Node.prototype.markDirty.call(this.node(id));
          if (parent) Node.prototype.markDirty.call(this.node(parent));
          return this.node(id);
        };
      case 'replaceWith':
        return (...children: NodeChild[]) => {
          const ids = this.expandChildren(children).map((child) => this.materialize(child));
          for (const childId of ids) {
            const oldParent = this.session.parent(childId);
            if (oldParent) this.invalidate(oldParent);
          }
          this.session.replaceWith(id, Uint32Array.from(ids));
          this.invalidate(id);
          for (const child of ids) this.ensureSnapshot(child);
          const parent = this.session.parent(ids[0] ?? id) || this.session.parent(id);
          if (parent) this.invalidate(parent);
          Node.prototype.markDirty.call(this.node(id));
          return this.node(id);
        };
      case 'clone':
        return (overrides: Record<string, unknown> = {}) => this.cloneNode(id, overrides);
      case 'cloneBefore':
        return (overrides: Record<string, unknown> = {}) => {
          const copy = this.cloneNode(id, overrides);
          const parent = this.session.parent(id);
          if (!parent) throw new Error('Cannot clone before a node without a parent');
          this.session.insertBefore(id, this.handleIds.get(copy)!);
          this.invalidate(parent);
          Node.prototype.markDirty.call(this.node(parent));
          return copy;
        };
      case 'cloneAfter':
        return (overrides: Record<string, unknown> = {}) => {
          const copy = this.cloneNode(id, overrides);
          const parent = this.session.parent(id);
          if (!parent) throw new Error('Cannot clone after a node without a parent');
          this.session.insertAfter(id, this.handleIds.get(copy)!);
          this.invalidate(parent);
          Node.prototype.markDirty.call(this.node(parent));
          return copy;
        };
      case 'before':
        return (...children: NodeChild[]) => {
          const parent = this.session.parent(id);
          if (!parent) throw new Error('Cannot insert before a node without a parent');
          for (const child of this.expandChildren(children)) {
            const childId = this.materialize(child);
            const oldParent = this.session.parent(childId);
            this.session.insertBefore(id, childId);
            if (oldParent && oldParent !== parent) this.invalidate(oldParent);
          }
          return this.afterStructure(parent, this.node(id));
        };
      case 'after':
        return (...children: NodeChild[]) => {
          const parent = this.session.parent(id);
          if (!parent) throw new Error('Cannot insert after a node without a parent');
          let target = id;
          for (const child of this.expandChildren(children)) {
            const childId = this.materialize(child);
            const oldParent = this.session.parent(childId);
            this.session.insertAfter(target, childId);
            if (oldParent && oldParent !== parent) this.invalidate(oldParent);
            target = childId;
          }
          return this.afterStructure(parent, this.node(id));
        };
      case 'removeAll':
        return () => {
          // Remove from the end so Root first-child before transfer does not
          // rewrite siblings that PostCSS would only detach via nodes = [].
          for (;;) {
            const count = this.session.childCount(id);
            if (count === 0) break;
            this.session.remove(this.session.childAt(id, count - 1));
          }
          return this.afterStructure(id);
        };
      case 'removeChild':
        return (child: Node | number) => {
          const childId = this.resolveChild(id, child);
          this.session.remove(childId);
          return this.afterStructure(id);
        };
      default:
        return unsupported(name);
    }
  }

  private afterStructure(id: number, result?: Node): Node {
    this.invalidate(id);
    this.ensureSnapshot(id);
    Node.prototype.markDirty.call(this.node(id));
    return result ?? this.node(id);
  }

  private cloneNode(id: number, overrides: Record<string, unknown>): Node {
    const cloned = this.session.clone(id);
    this.ingestSubtree(cloned);
    const wrapper = this.node(cloned);
    if (Object.prototype.hasOwnProperty.call(overrides, 'nodes')) {
      const nodes = overrides.nodes;
      for (;;) {
        const count = this.session.childCount(cloned);
        if (count === 0) break;
        this.session.remove(this.session.childAt(cloned, count - 1));
      }
      this.invalidate(cloned);
      if (Array.isArray(nodes)) {
        for (const child of this.expandChildren(nodes as NodeChild[])) {
          this.session.append(cloned, this.materialize(child));
        }
      }
    }
    for (const [key, value] of Object.entries(overrides)) {
      if (key === 'nodes' || key === 'type') continue;
      Reflect.set(wrapper, key, value);
    }
    this.flushPatches();
    this.invalidate(cloned);
    return this.node(cloned);
  }

  private resolveChild(parent: number, existing: Node | number): number {
    if (typeof existing === 'number') {
      const child = this.session.childAt(parent, existing);
      if (!child) throw new Error('Node is not a child of this container');
      return child;
    }
    const id = this.handleIds.get(existing);
    if (!id) throw new Error('foreign handle wrapper');
    return id;
  }

  private expandChildren(children: readonly NodeChild[]): unknown[] {
    const out: unknown[] = [];
    for (const child of flattenChildren(children)) {
      if (typeof child === 'string') out.push(...this.parseCssString(child));
      else out.push(child);
    }
    return out;
  }

  /** Parse a CSS string into session-local nodes via a temporary arena. */
  private parseCssString(css: string): Node[] {
    const temporary = new SessionOwner(this.addon, css, { mutableStructure: true });
    try {
      return [...(temporary.root.nodes ?? [])].map((node) => {
        // Clone into this arena immediately; the temporary session closes below.
        const id = this.materialize(node);
        return this.node(id);
      });
    } finally {
      temporary.session.close();
    }
  }

  private materialize(input: unknown): number {
    if (typeof input === 'string') {
      const nodes = this.parseCssString(input);
      if (nodes.length === 0) throw new HandleDeclarationUnsupportedError('string node insertion');
      if (nodes.length === 1) return this.handleIds.get(nodes[0])!;
      throw new HandleDeclarationUnsupportedError('multi-node string insertion');
    }
    if (!isPlainRecord(input) && !(input instanceof Node))
      throw new HandleDeclarationUnsupportedError('node creation');
    const unwrapped =
      input && typeof input === 'object' && 'proxyOf' in input
        ? ((input as { proxyOf: Node }).proxyOf as Node)
        : (input as Node | Record<string, unknown>);
    const existing = unwrapped instanceof Node ? this.handleIds.get(unwrapped) : undefined;
    if (existing) {
      const owner = wrapperOwners.get(unwrapped as Node);
      if (!owner || owner === this) return existing;
      // Foreign session identity cannot move; clone values into this arena.
      return this.materialize(this.cloneRecord(unwrapped as Node));
    }
    if (unwrapped instanceof Node) {
      const owner = wrapperOwners.get(unwrapped);
      if (owner && owner !== this) return this.materialize(this.cloneRecord(unwrapped));
    }
    const record = unwrapped as Record<string, unknown>;
    const type =
      typeof record.type === 'string'
        ? record.type
        : 'prop' in record
          ? 'decl'
          : 'selector' in record
            ? 'rule'
            : 'name' in record
              ? 'atrule'
              : 'text' in record
                ? 'comment'
                : 'nodes' in record
                  ? 'root'
                  : undefined;
    if (!type) throw new HandleDeclarationUnsupportedError('node creation');
    let id: number;
    switch (type) {
      case 'decl': {
        if (record.value === undefined) throw new Error('Value field is missed in node creation');
        id = this.session.newDecl(String(record.prop ?? ''), String(record.value));
        this.ensureSnapshot(id);
        if (record.important) (this.node(id) as Declaration).important = true;
        break;
      }
      case 'rule': {
        id = this.session.newRule(String(record.selector ?? ''));
        this.ensureSnapshot(id);
        break;
      }
      case 'atrule': {
        id = this.session.newAtRule(String(record.name ?? ''), String(record.params ?? ''));
        this.ensureSnapshot(id);
        break;
      }
      case 'comment': {
        id = this.session.newComment(String(record.text ?? ''));
        this.ensureSnapshot(id);
        break;
      }
      default:
        throw new HandleDeclarationUnsupportedError(`create ${type}`);
    }
    if (record.raws && isPlainRecord(record.raws)) {
      for (const [key, value] of Object.entries(record.raws)) {
        Reflect.set(this.node(id).raws, key, value);
      }
    }
    const childNodes = record.nodes;
    if (Array.isArray(childNodes)) {
      for (const child of this.expandChildren(childNodes as NodeChild[])) {
        this.session.append(id, this.materialize(child));
      }
      this.invalidate(id);
    }
    this.flushPatches();
    return id;
  }

  /** Copy public fields from a foreign/hydrated node for session-local creation. */
  private cloneRecord(node: Node): Record<string, unknown> {
    const record: Record<string, unknown> = { type: node.type };
    if (node.type === 'decl') {
      record.prop = (node as Declaration).prop;
      record.value = (node as Declaration).value;
      record.important = (node as Declaration).important;
    } else if (node.type === 'rule') {
      record.selector = (node as Rule).selector;
    } else if (node.type === 'atrule') {
      record.name = (node as AtRule).name;
      record.params = (node as AtRule).params;
    } else if (node.type === 'comment') {
      record.text = (node as Comment).text;
    }
    if (node.raws && isPlainRecord(node.raws)) record.raws = { ...node.raws };
    if (Array.isArray((node as unknown as { nodes?: unknown }).nodes))
      record.nodes = [...(node as unknown as { nodes: NodeChild[] }).nodes];
    return record;
  }

  private ensureSnapshot(id: number): void {
    if (this.snapshots.has(id)) return;
    this.ingestSubtree(id);
  }

  private ingestSubtree(id: number): void {
    const pending = [id];
    const seen = new Set<number>();
    while (pending.length) {
      const batch: number[] = [];
      while (pending.length && batch.length < 256) {
        const next = pending.pop()!;
        if (seen.has(next)) continue;
        seen.add(next);
        batch.push(next);
      }
      if (!batch.length) continue;
      const rows = JSON.parse(this.session.readSnapshots(Uint32Array.from(batch))) as Snapshot[];
      for (const row of rows) {
        this.snapshots.set(row.id, row);
        this.childrenCache.delete(row.id);
        for (const child of row.nodes ?? []) {
          if (!this.snapshots.has(child)) pending.push(child);
        }
      }
    }
  }

  private invalidate(...ids: number[]): void {
    for (const id of ids) {
      this.childrenCache.delete(id);
      this.rawsCache.delete(id);
      if (this.mutableStructure && this.snapshots.has(id)) {
        try {
          const rows = JSON.parse(this.session.readSnapshots(Uint32Array.from([id]))) as Snapshot[];
          const row = rows[0];
          if (row) {
            const existing = this.snapshots.get(id);
            if (existing) Object.assign(existing, row);
            else this.snapshots.set(id, row);
            // Sibling raws can change when Root transfers before on first-child removal.
            for (const child of row.nodes ?? []) {
              this.rawsCache.delete(child);
              const known = this.snapshots.get(child);
              if (!known) continue;
              try {
                const childRows = JSON.parse(
                  this.session.readSnapshots(Uint32Array.from([child])),
                ) as Snapshot[];
                if (childRows[0]) Object.assign(known, childRows[0]);
              } catch {
                // Child may have been detached in the same mutation.
              }
            }
          }
        } catch {
          // Detached or disposed nodes keep their last known snapshot.
        }
      }
    }
  }
}
