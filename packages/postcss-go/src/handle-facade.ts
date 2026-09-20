import {
  AtRule,
  Comment,
  Container,
  Declaration,
  Document,
  Node,
  Root,
  Rule,
  type NodeChild,
  type ProcessRoot,
  type WalkCallback,
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
  HandleSession,
  type HandleBridge,
  type HandleField,
  type HandleParseOptions,
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
  'push',
]);

const QUERY_METHODS = new Set([
  'root',
  'next',
  'prev',
  'cleanRaws',
  'replaceValues',
  'raw',
  'assign',
]);

const WALK_METHODS = new Set([
  'walk',
  'walkDecls',
  'walkRules',
  'walkAtRules',
  'walkComments',
  'some',
  'every',
  'index',
]);

const unsupported = (key: PropertyKey): never => {
  throw new HandleDeclarationUnsupportedError(String(key));
};

const protectedObjects = new WeakSet<object>();
const wrapperOwners = new WeakMap<Node, SessionOwner>();
/** Mutable so takeForeign can rebind a wrapper without replacing the Proxy. */
type WrapperBinding = {
  owner: SessionOwner;
  id: number;
  source?: Node['source'];
  raws?: Node['raws'];
};
const wrapperBindings = new WeakMap<Node, WrapperBinding>();

/** Protect snapshots, including reflection and nested array/raw writes. */
function immutable<T extends object>(value: T, cache: WeakMap<object, object>): T {
  if (protectedObjects.has(value)) return value;
  const known = cache.get(value);
  if (known) return known as T;
  const proxy = new Proxy(value, {
    get(target, key, receiver) {
      if (
        Array.isArray(target) &&
        typeof key === 'string' &&
        ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'].includes(key)
      ) {
        return () => unsupported(key);
      }
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

function isLocalRaw(value: unknown): boolean {
  return Array.isArray(value) || (isPlainRecord(value) && !('raw' in value && 'value' in value));
}

function pickLocalRaws(raws: unknown): Record<string, unknown> {
  if (!isPlainRecord(raws)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raws)) {
    if (isLocalRaw(value)) out[key] = value;
  }
  return out;
}

export type SessionOwnerOptions = HandleParseOptions & {
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

/** The session that owns a wrapper, or undefined for a detached TypeScript node. */
export function ownerOf(node: Node): SessionOwner | undefined {
  return wrapperOwners.get(node);
}

/** One owner and wrapper cache per Go arena. Every retained wrapper retains this owner. */
export class SessionOwner {
  readonly session: HandleSession;
  readonly mutableScalars: boolean;
  readonly mutableStructure: boolean;
  readonly diagnostics: HandleDiagnostics = {
    planReason: '',
    hydration: false,
    visits: 0,
  };
  private readonly bridge: HandleBridge;
  private readonly snapshots = new Map<number, Snapshot>();
  private readonly wrappers = new Map<number, Node>();
  private readonly handleIds = new WeakMap<Node, number>();
  private readonly childrenCache = new Map<number, Node[]>();
  private readonly rawsCache = new Map<number, Node['raws']>();
  private readonly input: Input;
  private readonly readCache = new WeakMap<object, object>();
  private readonly targets = new WeakMap<Node, Node>();
  private pending: PendingPatch[] = [];

  constructor(bridge: HandleBridge, css: string, options: SessionOwnerOptions = {}) {
    this.bridge = bridge;
    this.mutableStructure = options.mutableStructure === true;
    this.mutableScalars = options.mutableScalars === true || this.mutableStructure;
    this.session = new HandleSession(bridge);
    // Keep map options so PreviousMap attaches for previous-map composition.
    this.input = new Input(css, {
      from: options.from,
      document: options.document,
      map: options.map,
    });
    this.input.fromOffset(0); // Initialize the Input's read cache before protecting it.
    this.input = immutable(this.input, this.readCache);
    try {
      const previous = this.input.map;
      this.session.parse(this.input.css, {
        from: options.from,
        document: options.document,
        trackSource: true,
        // Hand Go the resolved previous map so composition happens where the
        // positions are recorded instead of being replayed in JavaScript.
        sourceMap: previousMapTextForGo(previous),
        sourceMapUrl: previous?.mapFile,
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

  /** Intern a detached node or JSON-shaped record into this arena. */
  intern(input: unknown): Node {
    if (input instanceof Root || (isPlainRecord(input) && input.type === 'root')) {
      const record = input instanceof Node ? this.cloneRecord(input) : input;
      const childNodes = Array.isArray(record.nodes) ? record.nodes : [];
      (this.structuralMethod(this.session.rootHandle, 'removeAll') as () => Node)();
      for (const child of this.expandChildren(childNodes as NodeChild[])) {
        this.session.append(this.session.rootHandle, this.materialize(child));
      }
      this.invalidate(this.session.rootHandle);
      this.flushPatches();
      if (record.raws && isPlainRecord(record.raws)) {
        for (const [key, value] of Object.entries(record.raws)) {
          Reflect.set(this.root.raws, key, value);
        }
        if (!Object.prototype.hasOwnProperty.call(record.raws, 'after')) {
          delete this.root.raws.after;
        }
      } else {
        delete this.root.raws.after;
      }
      if (record.source) this.root.source = record.source as Node['source'];
      else this.root.source = undefined;
      return this.root;
    }
    if (input instanceof Document || (isPlainRecord(input) && input.type === 'document')) {
      throw new HandleDeclarationUnsupportedError('document intern');
    }
    return this.node(this.materialize(input));
  }

  close(): void {
    this.session.close();
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
    const binding: WrapperBinding = { owner: this, id };
    const currentRow = (): Snapshot => {
      const current = binding.owner.snapshots.get(binding.id);
      if (!current) throw new Error('invalid snapshot relationship');
      return current;
    };
    const read = (key: PropertyKey): unknown => {
      const owner = binding.owner;
      const currentId = binding.id;
      const liveRow = currentRow();
      if (typeof key === 'symbol') return Reflect.get(target, key);
      if (key === 'source') {
        if (!liveRow.source) return undefined;
        const explicitInput = (liveRow.source as { input?: Input }).input;
        // Parsed arenas always expose the session Input. Empty intern arenas
        // only keep an input that was copied from the constructed node.
        const input =
          explicitInput ?? (owner.input.css || owner.input.file ? owner.input : undefined);
        const located = {
          ...liveRow.source,
          ...(liveRow.source.start ? { start: { ...liveRow.source.start } } : {}),
          ...(liveRow.source.end ? { end: { ...liveRow.source.end } } : {}),
          ...(input ? { input } : {}),
        };
        if (owner.mutableStructure) return (binding.source ??= located as Node['source']);
        return (binding.source ??= immutable(located, owner.readCache));
      }
      if (key === 'block' && liveRow.type === 'atrule') return liveRow.block;
      if (key === 'raws') {
        if (owner.mutableStructure) return owner.trackedRaws(currentId, liveRow);
        return (binding.raws ??= immutable(liveRow.raws ?? {}, owner.readCache));
      }
      if (key === 'parent') {
        const parentId = owner.mutableStructure ? owner.session.parent(currentId) : liveRow.parent;
        if (parentId) return owner.node(parentId);
        return Reflect.get(target, 'parent');
      }
      if (key === 'nodes' && Object.hasOwn(fields, 'nodes')) {
        if (liveRow.type === 'atrule' && !liveRow.block && !owner.mutableStructure)
          return undefined;
        if (owner.mutableStructure) {
          if (liveRow.type === 'atrule') {
            const live = owner.liveNodes(currentId);
            if (live.length === 0 && !liveRow.block) return undefined;
            return live;
          }
          return owner.liveNodes(currentId);
        }
        return owner.frozenNodes(currentId, liveRow);
      }
      if (key === 'selectors' && liveRow.type === 'rule') {
        return list.comma(String(Reflect.get(target, 'selector') ?? ''));
      }
      return Reflect.get(target, key, wrapper);
    };
    const writeStructural = (key: string, value: unknown): boolean => {
      const owner = binding.owner;
      const currentId = binding.id;
      if (!owner.mutableStructure) return unsupported(key);
      if (key === 'nodes') {
        if (value == null) {
          (owner.structuralMethod(currentId, 'removeAll') as () => Node)();
          return true;
        }
        if (!Array.isArray(value)) return unsupported(key);
        (owner.structuralMethod(currentId, 'removeAll') as () => Node)();
        for (const child of owner.expandChildren(value as NodeChild[])) {
          owner.session.append(currentId, owner.materialize(child));
        }
        owner.afterStructure(currentId);
        return true;
      }
      if (key === 'parent') {
        if (value == null) {
          const parent = owner.session.parent(currentId);
          if (parent) {
            owner.session.remove(currentId);
            owner.invalidate(currentId);
            owner.invalidate(parent);
            Node.prototype.markDirty.call(owner.node(currentId));
            Node.prototype.markDirty.call(owner.node(parent));
          }
          Reflect.set(target, 'parent', undefined);
          return true;
        }
        if (value instanceof Node) {
          Reflect.set(target, 'parent', value);
          return true;
        }
        return unsupported(key);
      }
      return unsupported(key);
    };
    const writeScalar = (key: string, value: unknown): boolean => {
      const owner = binding.owner;
      const currentId = binding.id;
      const liveRow = currentRow();
      if (key === 'nodes' || key === 'parent') return writeStructural(key, value);
      if (key === 'lastEach' || key === 'indexes') return Reflect.set(target, key, value);
      if (key === 'source') {
        liveRow.source = (value ?? undefined) as Snapshot['source'];
        binding.source = value as Node['source'];
        return true;
      }
      if (key === 'block' && liveRow.type === 'atrule') {
        if (value) owner.session.query(currentId, 'setBlock');
        liveRow.block = Boolean(value);
        Reflect.set(target, 'block', liveRow.block);
        Node.prototype.markDirty.call(wrapper);
        return true;
      }
      if (!owner.mutableScalars) return unsupported(key);
      if (key === 'selectors' && liveRow.type === 'rule') {
        const values = Array.isArray(value) ? value.map(String) : [String(value)];
        const current = String(Reflect.get(target, 'selector') ?? '');
        const match = current.match(/,\s*/);
        let sep = match ? match[0] : undefined;
        if (sep === undefined) {
          const inferred = owner.session.query(currentId, 'raw', {
            prop: 'between',
            defaultType: 'beforeOpen',
          });
          const between =
            inferred && typeof inferred === 'object' && inferred !== null && 'raw' in inferred
              ? String((inferred as { raw: string }).raw)
              : String(inferred ?? ' ');
          sep = `,${between}`;
        }
        return writeScalar('selector', values.join(sep));
      }
      const field = SCALAR_FIELDS[liveRow.type]?.[key];
      if (field === undefined) {
        Reflect.set(target, key, value);
        return true;
      }
      const encoded = encodeScalar(key, value);
      if (Reflect.get(target, key) === encoded.local) return true;
      Reflect.set(target, key, encoded.local);
      if (key === 'prop') liveRow.prop = encoded.local as string;
      if (key === 'value') liveRow.value = encoded.local as string;
      if (key === 'important') liveRow.important = encoded.local as boolean;
      if (key === 'selector') liveRow.selector = encoded.local as string;
      if (key === 'name') liveRow.name = encoded.local as string;
      if (key === 'params') liveRow.params = encoded.local as string;
      if (key === 'text') liveRow.text = encoded.local as string;
      owner.pending.push({ id: currentId, field, value: encoded.wire });
      Node.prototype.markDirty.call(wrapper);
      return true;
    };
    const wrapper = new Proxy(target, {
      get: (_target, key) => {
        const owner = binding.owner;
        const currentId = binding.id;
        if (key === 'toProxy') return () => wrapper;
        if (key === 'toString')
          return (stringifier?: Parameters<Node['toString']>[0]) => {
            owner.flushPatches();
            return stringifier === undefined
              ? owner.session.stringify(currentId)
              : Node.prototype.toString.call(wrapper, stringifier);
          };
        if (key === 'each') return Container.prototype.each.bind(wrapper);
        if (typeof key === 'string' && QUERY_METHODS.has(key))
          return owner.queryMethod(currentId, key);
        if (typeof key === 'string' && WALK_METHODS.has(key))
          return owner.walkMethod(currentId, key);
        if (typeof key === 'string' && STRUCTURAL_METHODS.has(key)) {
          if (!owner.mutableStructure) return unsupported(key);
          return owner.structuralMethod(currentId, key);
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
      deleteProperty: (_target, key) => {
        if (key === 'parent') return writeStructural('parent', null);
        if (typeof key === 'string' && (key === 'source' || key === 'nodes')) {
          return writeScalar(key, undefined);
        }
        return unsupported(key);
      },
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
    wrapperBindings.set(wrapper, binding);
    return wrapper;
  }

  private queryMethod(id: number, key: string) {
    const handleOf = (value: number) => (value ? this.node(value) : undefined);
    switch (key) {
      case 'root':
        return () => handleOf(this.session.query<number>(id, 'root')) ?? this.root;
      case 'next':
        return () => handleOf(this.session.query<number>(id, 'next'));
      case 'prev':
        return () => handleOf(this.session.query<number>(id, 'prev'));
      case 'cleanRaws':
        return (keepBetween = false) => {
          this.session.query(id, 'cleanRaws', { keepBetween });
          this.invalidateTree(id);
        };
      case 'replaceValues':
        return (
          pattern: string | RegExp,
          optionsOrReplacement:
            | string
            | { props?: readonly string[]; fast?: string }
            | ((...args: string[]) => string),
          maybeCallback?: (...args: string[]) => string,
        ) => {
          const options =
            typeof optionsOrReplacement === 'object' && optionsOrReplacement !== null
              ? optionsOrReplacement
              : {};
          const replacement =
            typeof optionsOrReplacement === 'object' && optionsOrReplacement !== null
              ? maybeCallback
              : optionsOrReplacement;
          if (replacement === undefined) throw new Error('replaceValues requires a replacement');
          const node = this.node(id) as Node & {
            walkDecls?: (callback: (decl: Declaration) => unknown) => unknown;
          };
          node.walkDecls?.((decl: Declaration) => {
            if (options.props && !options.props.includes(decl.prop)) return;
            if (options.fast && !decl.value.includes(options.fast)) return;
            decl.value =
              typeof replacement === 'string'
                ? decl.value.replace(pattern, replacement)
                : decl.value.replace(pattern as never, replacement as never);
          });
          this.flushPatches();
          return node;
        };
      case 'raw':
        return (prop: string, defaultType?: string) => {
          const inferred = this.session.query(id, 'raw', {
            prop,
            defaultType: defaultType ?? prop,
          });
          if (inferred && typeof inferred === 'object' && 'raw' in (inferred as object)) {
            return (inferred as { raw: string }).raw;
          }
          return inferred;
        };
      case 'assign':
        return (overrides: Record<string, unknown> = {}) => {
          const node = this.node(id);
          Object.assign(node, overrides);
          Node.prototype.markDirty.call(node);
          return node;
        };
      default:
        return unsupported(key);
    }
  }

  private walkMethod(id: number, key: string) {
    switch (key) {
      case 'walk':
        return (callback: WalkCallback) => this.walkFrom(id, callback);
      case 'walkDecls':
        return (
          propOrCallback: string | RegExp | ((node: Declaration, index: number) => unknown),
          callback?: (node: Declaration, index: number) => unknown,
        ) => {
          const visit = typeof propOrCallback === 'function' ? propOrCallback : callback;
          if (!visit) throw new Error('walkDecls requires a callback');
          return this.walkFrom(id, (node, index) => {
            if (node.type !== 'decl') return;
            const decl = node as Declaration;
            if (typeof propOrCallback === 'string' && decl.prop !== propOrCallback) return;
            if (propOrCallback instanceof RegExp) {
              propOrCallback.lastIndex = 0;
              if (!propOrCallback.test(decl.prop)) return;
            }
            return visit(decl, index);
          });
        };
      case 'walkRules':
        return (
          selectorOrCallback: string | RegExp | ((node: Rule, index: number) => unknown),
          callback?: (node: Rule, index: number) => unknown,
        ) => {
          const visit = typeof selectorOrCallback === 'function' ? selectorOrCallback : callback;
          if (!visit) throw new Error('walkRules requires a callback');
          return this.walkFrom(id, (node, index) => {
            if (node.type !== 'rule') return;
            const rule = node as Rule;
            if (typeof selectorOrCallback === 'string' && rule.selector !== selectorOrCallback)
              return;
            if (selectorOrCallback instanceof RegExp) {
              selectorOrCallback.lastIndex = 0;
              if (!selectorOrCallback.test(rule.selector)) return;
            }
            return visit(rule, index);
          });
        };
      case 'walkAtRules':
        return (
          nameOrCallback: string | RegExp | ((node: AtRule, index: number) => unknown),
          callback?: (node: AtRule, index: number) => unknown,
        ) => {
          const visit = typeof nameOrCallback === 'function' ? nameOrCallback : callback;
          if (!visit) throw new Error('walkAtRules requires a callback');
          return this.walkFrom(id, (node, index) => {
            if (node.type !== 'atrule') return;
            const atRule = node as AtRule;
            if (typeof nameOrCallback === 'string' && atRule.name !== nameOrCallback) return;
            if (nameOrCallback instanceof RegExp) {
              nameOrCallback.lastIndex = 0;
              if (!nameOrCallback.test(atRule.name)) return;
            }
            return visit(atRule, index);
          });
        };
      case 'walkComments':
        return (callback: (node: Comment, index: number) => unknown) =>
          this.walkFrom(id, (node, index) =>
            node.type === 'comment' ? callback(node as Comment, index) : undefined,
          );
      case 'some':
        return (callback: (node: Node, index: number, nodes: Node[]) => boolean) => {
          const nodes = this.liveNodes(id);
          return nodes.some(callback);
        };
      case 'every':
        return (callback: (node: Node, index: number, nodes: Node[]) => boolean) => {
          const nodes = this.liveNodes(id);
          return nodes.every(callback);
        };
      case 'index':
        return (child: Node | number) => {
          if (typeof child === 'number') return child;
          return this.liveNodes(id).indexOf(child);
        };
      default:
        return unsupported(key);
    }
  }

  private walkFrom(id: number, callback: WalkCallback): false | undefined {
    const node = this.node(id);
    if (!(node instanceof Container) || typeof node.each !== 'function') return undefined;
    return node.each((child, index) => {
      let result: unknown;
      try {
        result = callback(child, index);
      } catch (error) {
        throw child.addToError(error instanceof Error ? error : new Error(String(error)));
      }
      if (result === false) return false;
      const childId = this.handleIds.get(child);
      if (childId !== undefined && child instanceof Container) {
        return this.walkFrom(childId, callback);
      }
      return result;
    });
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
    // Proxy traps are not class methods, so they cannot close over `this` as a method.
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- trap handlers
    const self = this;
    const snapshot = (): Node[] => {
      const nodes: Node[] = [];
      const count = self.session.childCount(id);
      for (let i = 0; i < count; i++) nodes.push(self.node(self.session.childAt(id, i)));
      return nodes;
    };
    const proxy = new Proxy([] as Node[], {
      get(_obj, key, _receiver) {
        if (key === 'length') return self.session.childCount(id);
        if (typeof key === 'string' && /^\d+$/.test(key)) {
          const index = Number(key);
          const count = self.session.childCount(id);
          if (index < 0 || index >= count) return undefined;
          return self.node(self.session.childAt(id, index));
        }
        if (key === 'push') {
          if (!self.mutableStructure) return () => unsupported('push');
          return (...items: NodeChild[]) => {
            (self.structuralMethod(id, 'append') as (...children: NodeChild[]) => Node)(...items);
            self.childrenCache.set(id, proxy);
            return self.session.childCount(id);
          };
        }
        if (key === 'pop' || key === 'shift' || key === 'unshift') {
          if (!self.mutableStructure) return () => unsupported(String(key));
        }
        if (key === 'sort') {
          return (cmp?: (a: Node, b: Node) => number) => {
            const current = snapshot().sort(cmp);
            (self.structuralMethod(id, 'removeAll') as () => Node)();
            for (const child of current) self.session.append(id, self.materialize(child));
            self.afterStructure(id);
            self.childrenCache.set(id, proxy);
            return proxy;
          };
        }
        if (key === 'splice') {
          return (start: number, deleteCount?: number, ...items: NodeChild[]) => {
            const from = Math.max(0, start);
            const remove =
              deleteCount === undefined
                ? self.session.childCount(id) - from
                : Math.max(0, deleteCount);
            const removed: Node[] = [];
            for (let i = 0; i < remove && from < self.session.childCount(id); i++) {
              const childId = self.session.childAt(id, from);
              removed.push(self.node(childId));
              self.session.remove(childId);
            }
            let insertAt = Math.min(from, self.session.childCount(id));
            for (const item of items) {
              const childId = self.materialize(item);
              if (insertAt >= self.session.childCount(id)) self.session.append(id, childId);
              else self.session.insertBefore(self.session.childAt(id, insertAt), childId);
              insertAt += 1;
            }
            self.afterStructure(id);
            self.childrenCache.set(id, proxy);
            return removed;
          };
        }
        const current = snapshot();
        const value = Reflect.get(current, key, current);
        return typeof value === 'function'
          ? (value as (...args: never[]) => unknown).bind(current)
          : value;
      },
      set(_obj, key, value) {
        if (key === 'length' && (value === 0 || value === '0')) {
          (self.structuralMethod(id, 'removeAll') as () => Node)();
          self.childrenCache.set(id, proxy);
          return true;
        }
        if (typeof key === 'string' && /^\d+$/.test(key)) {
          const index = Number(key);
          const count = self.session.childCount(id);
          const childId = self.materialize(value);
          if (index < count) {
            const existing = self.session.childAt(id, index);
            if (existing === childId) return true;
            self.session.insertBefore(existing, childId);
            self.session.remove(existing);
          } else {
            self.session.append(id, childId);
          }
          self.afterStructure(id);
          self.childrenCache.set(id, proxy);
          return true;
        }
        return unsupported(key);
      },
      ownKeys() {
        const keys: (string | symbol)[] = ['length'];
        const count = self.session.childCount(id);
        for (let i = 0; i < count; i++) keys.push(String(i));
        return keys;
      },
      getOwnPropertyDescriptor(_obj, key) {
        if (key === 'length') {
          return {
            configurable: false,
            enumerable: false,
            value: self.session.childCount(id),
            writable: true,
          };
        }
        if (typeof key === 'string' && /^\d+$/.test(key)) {
          const index = Number(key);
          if (index < 0 || index >= self.session.childCount(id)) return undefined;
          return {
            configurable: true,
            enumerable: true,
            writable: true,
            value: self.node(self.session.childAt(id, index)),
          };
        }
        return Reflect.getOwnPropertyDescriptor(snapshot(), key);
      },
      has(_obj, key) {
        if (key === 'length') return true;
        if (typeof key === 'string' && /^\d+$/.test(key)) {
          const index = Number(key);
          return index >= 0 && index < self.session.childCount(id);
        }
        return Reflect.has(snapshot(), key);
      },
    });
    this.childrenCache.set(id, proxy);
    return proxy;
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
        } else if (isPlainRecord(value) || Array.isArray(value)) {
          Reflect.set(target, key, value);
          row.raws = target as Node['raws'];
          Node.prototype.markDirty.call(this.node(id));
          return true;
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

  private structuralMethod(id: number, name: string): (...args: any[]) => Node {
    const move = (childId: number, apply: () => void): void => {
      const oldParent = this.session.parent(childId);
      const oldAt = oldParent ? this.childIndex(oldParent, childId) : -1;
      apply();
      if (oldParent && oldParent !== id) {
        if (oldAt >= 0) this.shiftWalkIndexes(oldParent, oldAt, -1);
        this.invalidate(oldParent);
      }
    };
    switch (name) {
      case 'append':
        return (...children: NodeChild[]) => {
          const flattenRoots = this.snapshots.get(id)?.type !== 'document';
          const sampleId =
            this.session.childCount(id) > 0
              ? this.session.childAt(id, this.session.childCount(id) - 1)
              : undefined;
          const insertedIds: number[] = [];
          for (const child of this.expandChildren(children, flattenRoots)) {
            const childId = this.materialize(child);
            move(childId, () => this.session.append(id, childId));
            this.syncInferredBetween(childId);
            insertedIds.push(childId);
          }
          this.inheritRootBefore(id, insertedIds, sampleId, 'append');
          return this.afterStructure(id);
        };
      case 'prepend':
        return (...children: NodeChild[]) => {
          const flattenRoots = this.snapshots.get(id)?.type !== 'document';
          const inserted = this.expandChildren(children, flattenRoots);
          const insertedIds: number[] = [];
          for (const child of [...inserted].reverse()) {
            const childId = this.materialize(child);
            move(childId, () => this.session.prepend(id, childId));
            this.syncInferredBetween(childId);
            insertedIds.unshift(childId);
            this.inheritRootBefore(id, [childId], undefined, 'prepend');
            if (this.session.childCount(id) === 2) this.inheritRootNewline(id);
          }
          this.shiftWalkIndexes(id, Number.NEGATIVE_INFINITY, inserted.length);
          return this.afterStructure(id);
        };
      case 'push':
        return (child: NodeChild) => {
          const childId = this.materialize(child);
          move(childId, () => this.session.append(id, childId));
          this.session.setRaw(childId, { key: 'before', kind: 'delete' });
          return this.afterStructure(id);
        };
      case 'insertBefore':
        return (existing: Node | number, ...children: NodeChild[]) => {
          const flattenRoots = this.snapshots.get(id)?.type !== 'document';
          const target = this.resolveChild(id, existing);
          const at = this.childIndex(id, target);
          const inserted = this.expandChildren(children, flattenRoots);
          const insertedIds: number[] = [];
          for (const child of inserted) {
            const childId = this.materialize(child);
            move(childId, () => this.session.insertBefore(target, childId));
            this.syncInferredBetween(childId);
            insertedIds.push(childId);
            if (at === 0) this.inheritRootBefore(id, [childId], undefined, 'prepend');
            else this.inheritRootBefore(id, [childId], target, 'append');
          }
          this.shiftWalkIndexes(id, at, inserted.length);
          if (at === 0 && this.session.childCount(id) === inserted.length + 1) {
            this.inheritRootNewline(id);
          }
          return this.afterStructure(id);
        };
      case 'insertAfter':
        return (existing: Node | number, ...children: NodeChild[]) => {
          if (typeof existing === 'number' && existing < 0) {
            const count = this.session.childCount(id);
            if (count === 0) {
              return (this.structuralMethod(id, 'append') as (...nodes: NodeChild[]) => Node)(
                ...children,
              );
            }
            const index = Math.max(0, count + existing);
            const target = this.session.childAt(id, index);
            const inserted = this.expandChildren(children);
            for (const child of inserted) {
              const childId = this.materialize(child);
              move(childId, () => this.session.insertBefore(target, childId));
              this.syncInferredBetween(childId);
            }
            this.shiftWalkIndexes(id, existing, inserted.length, true);
            return this.afterStructure(id);
          }
          let target = this.resolveChild(id, existing);
          const sampleId = target;
          const flattenRoots = this.snapshots.get(id)?.type !== 'document';
          const at = this.childIndex(id, target);
          const inserted = this.expandChildren(children, flattenRoots);
          const insertedIds: number[] = [];
          for (const child of inserted) {
            const childId = this.materialize(child);
            move(childId, () => this.session.insertAfter(target, childId));
            this.syncInferredBetween(childId);
            insertedIds.push(childId);
            target = childId;
          }
          this.shiftWalkIndexes(id, at, inserted.length, true);
          this.inheritRootBefore(id, insertedIds, sampleId, 'append');
          return this.afterStructure(id);
        };
      case 'remove':
        return () => {
          const parent = this.session.parent(id);
          const at = parent ? this.childIndex(parent, id) : -1;
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
          if (parent && at >= 0) this.shiftWalkIndexes(parent, at, -1);
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
          const at = this.childIndex(parent, id);
          this.session.insertBefore(id, this.handleIds.get(copy)!);
          if (at >= 0) this.shiftWalkIndexes(parent, at, 1);
          this.invalidate(parent);
          Node.prototype.markDirty.call(this.node(parent));
          return copy;
        };
      case 'cloneAfter':
        return (overrides: Record<string, unknown> = {}) => {
          const copy = this.cloneNode(id, overrides);
          const parent = this.session.parent(id);
          if (!parent) throw new Error('Cannot clone after a node without a parent');
          const at = this.childIndex(parent, id);
          this.session.insertAfter(id, this.handleIds.get(copy)!);
          if (at >= 0) this.shiftWalkIndexes(parent, at, 1, true);
          this.invalidate(parent);
          Node.prototype.markDirty.call(this.node(parent));
          return copy;
        };
      case 'before':
        return (...children: NodeChild[]) => {
          const parent = this.session.parent(id);
          if (!parent) throw new Error('Cannot insert before a node without a parent');
          const at = this.childIndex(parent, id);
          const inserted = this.expandChildren(children);
          for (const child of inserted) {
            const childId = this.materialize(child);
            const oldParent = this.session.parent(childId);
            const oldAt = oldParent ? this.childIndex(oldParent, childId) : -1;
            this.session.insertBefore(id, childId);
            if (oldParent && oldParent !== parent) {
              if (oldAt >= 0) this.shiftWalkIndexes(oldParent, oldAt, -1);
              this.invalidate(oldParent);
            }
          }
          if (at >= 0) this.shiftWalkIndexes(parent, at, inserted.length);
          return this.afterStructure(parent, this.node(id));
        };
      case 'after':
        return (...children: NodeChild[]) => {
          const parent = this.session.parent(id);
          if (!parent) throw new Error('Cannot insert after a node without a parent');
          const at = this.childIndex(parent, id);
          const inserted = this.expandChildren(children);
          let target = id;
          for (const child of inserted) {
            const childId = this.materialize(child);
            const oldParent = this.session.parent(childId);
            const oldAt = oldParent ? this.childIndex(oldParent, childId) : -1;
            this.session.insertAfter(target, childId);
            if (oldParent && oldParent !== parent) {
              if (oldAt >= 0) this.shiftWalkIndexes(oldParent, oldAt, -1);
              this.invalidate(oldParent);
            }
            target = childId;
          }
          if (at >= 0) this.shiftWalkIndexes(parent, at, inserted.length, true);
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
        return (child: Node | number, ignore = false) => {
          const childId = this.resolveChild(id, child);
          const at = this.childIndex(id, childId);
          // Go Root.RemoveChild always transfers before; PostCSS skips that when
          // ignore is true (used when moving a first child into another tree).
          let restore: { node: Node; before: unknown; present: boolean } | undefined;
          if (
            ignore &&
            at === 0 &&
            this.snapshots.get(id)?.type === 'root' &&
            this.session.childCount(id) > 1
          ) {
            const next = this.node(this.session.childAt(id, 1));
            restore = {
              node: next,
              before: next.raws.before,
              present: Object.prototype.hasOwnProperty.call(next.raws, 'before'),
            };
          }
          this.session.remove(childId);
          if (restore) {
            if (restore.present)
              restore.node.raws.before = restore.before as Node['raws']['before'];
            else delete restore.node.raws.before;
          }
          if (at >= 0) this.shiftWalkIndexes(id, at, -1);
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
    this.copyLocalRaws(id, cloned);
    return this.node(cloned);
  }

  private resolveChild(parent: number, existing: Node | number): number {
    if (typeof existing === 'number') {
      const child = this.session.childAt(parent, existing);
      if (!child) throw new Error('Node is not a child of this container');
      return child;
    }
    const id = this.handleIds.get(existing);
    if (!id || this.session.parent(id) !== parent)
      throw new Error('Node is not a child of this container');
    return id;
  }

  private expandChildren(children: readonly NodeChild[], flattenRoots = true): unknown[] {
    const out: unknown[] = [];
    for (const child of flattenChildren(children)) {
      if (typeof child === 'string') out.push(...this.parseCssString(child));
      else if (flattenRoots && child instanceof Root) out.push(...(child.nodes ?? []));
      else out.push(child);
    }
    return out;
  }

  /** Parse a CSS string into session-local nodes via a temporary arena. */
  private parseCssString(css: string): Node[] {
    const temporary = new SessionOwner(this.bridge, css, { mutableStructure: true });
    try {
      return [...(temporary.root.nodes ?? [])].map((node) => {
        const id = this.materialize(node);
        const interned = this.node(id);
        interned.source = undefined;
        return interned;
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
      return this.takeForeign(unwrapped as Node);
    }
    if (unwrapped instanceof Node) {
      const owner = wrapperOwners.get(unwrapped);
      if (owner && owner !== this) return this.takeForeign(unwrapped);
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
    if (!type) throw new Error('Unknown node type in node creation');
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
        throw new Error(`Unknown node type ${type}`);
    }
    if (record.raws && isPlainRecord(record.raws)) {
      for (const [key, value] of Object.entries(record.raws)) {
        Reflect.set(this.node(id).raws, key, value);
      }
    }
    if (record.source && typeof record.source === 'object') {
      const row = this.snapshots.get(id);
      if (row) row.source = record.source as Snapshot['source'];
    }
    const childNodes = record.nodes;
    const wantsBlock = type === 'atrule' && (Array.isArray(childNodes) || record.block === true);
    if (wantsBlock) this.session.query(id, 'setBlock');
    if (Array.isArray(childNodes)) {
      for (const child of this.expandChildren(childNodes as NodeChild[])) {
        this.session.append(id, this.materialize(child));
      }
    }
    if (wantsBlock || Array.isArray(childNodes)) this.invalidate(id);
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
      record.block = (node as AtRule).block;
    } else if (node.type === 'comment') {
      record.text = (node as Comment).text;
    }
    if (node.raws && isPlainRecord(node.raws)) record.raws = { ...node.raws };
    if (node.source) record.source = node.source;
    if (Array.isArray((node as unknown as { nodes?: unknown }).nodes))
      record.nodes = [...(node as unknown as { nodes: NodeChild[] }).nodes];
    return record;
  }

  private applyLocalRaws(id: number, raws: unknown): void {
    if (!isPlainRecord(raws)) return;
    const dest = this.node(id).raws as Record<string, unknown>;
    for (const [key, value] of Object.entries(raws)) {
      if (!isLocalRaw(value)) continue;
      try {
        Reflect.set(dest, key, structuredClone(value));
      } catch {
        Reflect.set(dest, key, value);
      }
    }
  }

  /** Clone a node out of another arena and rebind the original wrapper here. */
  private takeForeign(node: Node): number {
    const previous = wrapperBindings.get(node);
    const oldOwner = previous?.owner ?? wrapperOwners.get(node);
    const oldId = previous?.id ?? oldOwner?.handleId(node);
    const record = this.cloneRecord(node);
    const cloned = this.materialize(record);
    if (oldOwner && oldId !== undefined && oldOwner !== this) {
      let oldParent: number | undefined;
      let restore: { node: Node; before: unknown; present: boolean } | undefined;
      try {
        oldParent = oldOwner.session.parent(oldId);
        if (oldParent && oldOwner.snapshots.get(oldParent)?.type === 'root') {
          const count = oldOwner.session.childCount(oldParent);
          if (count > 1 && oldOwner.session.childAt(oldParent, 0) === oldId) {
            const next = oldOwner.node(oldOwner.session.childAt(oldParent, 1));
            restore = {
              node: next,
              before: next.raws.before,
              present: Object.prototype.hasOwnProperty.call(next.raws, 'before'),
            };
          }
        }
      } catch {
        oldParent = undefined;
      }
      oldOwner.wrappers.delete(oldId);
      oldOwner.childrenCache.delete(oldId);
      oldOwner.rawsCache.delete(oldId);
      try {
        oldOwner.session.remove(oldId);
      } catch {
        // Already detached from its previous parent.
      }
      if (restore) {
        if (restore.present) restore.node.raws.before = restore.before as Node['raws']['before'];
        else delete restore.node.raws.before;
      }
      if (oldParent) oldOwner.invalidate(oldParent);
    }
    const created = this.wrappers.get(cloned);
    if (created && created !== node) {
      this.wrappers.delete(cloned);
      this.handleIds.delete(created);
      wrapperOwners.delete(created);
      wrapperBindings.delete(created);
    }
    this.wrappers.set(cloned, node);
    this.handleIds.set(node, cloned);
    wrapperOwners.set(node, this);
    const target = oldOwner?.targets.get(node);
    if (oldOwner && target) {
      oldOwner.targets.delete(node);
      this.targets.set(node, target);
    }
    if (previous) {
      previous.owner = this;
      previous.id = cloned;
      previous.source = undefined;
      previous.raws = undefined;
    } else {
      wrapperBindings.set(node, { owner: this, id: cloned });
    }
    this.ensureSnapshot(cloned);
    this.applyLocalRaws(cloned, record.raws);
    return cloned;
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

  private childIndex(parent: number, child: number): number {
    const count = this.session.childCount(parent);
    for (let i = 0; i < count; i++) {
      if (this.session.childAt(parent, i) === child) return i;
    }
    return -1;
  }

  private shiftWalkIndexes(id: number, fromIndex: number, delta: number, exclusive = false): void {
    if (!delta) return;
    const target = this.targets.get(this.node(id)) as
      | { indexes?: Map<number, number> | Record<string, number> }
      | undefined;
    const indexes = target?.indexes;
    if (!indexes) return;
    const entries: Array<[string | number, number]> =
      indexes instanceof Map
        ? [...indexes.entries()]
        : Object.entries(indexes).map(([key, value]) => [key, Number(value)]);
    for (const [key, index] of entries) {
      if (exclusive ? fromIndex < index : fromIndex <= index) {
        const next = index + delta;
        if (indexes instanceof Map) indexes.set(Number(key), next);
        else (indexes as Record<string, number>)[String(key)] = next;
      }
    }
  }

  /** Copy JS-only nested raws that Go clone does not store. */
  private copyLocalRaws(from: number, to: number): void {
    const source = this.node(from).raws as Record<string, unknown>;
    const dest = this.node(to).raws as Record<string, unknown>;
    for (const [key, value] of Object.entries(source)) {
      if (!isLocalRaw(value)) continue;
      try {
        Reflect.set(dest, key, structuredClone(value));
      } catch {
        Reflect.set(dest, key, value);
      }
    }
    const count = Math.min(this.session.childCount(from), this.session.childCount(to));
    for (let i = 0; i < count; i++) {
      this.copyLocalRaws(this.session.childAt(from, i), this.session.childAt(to, i));
    }
  }

  private inheritRootNewline(id: number): void {
    if (this.snapshots.get(id)?.type !== 'root') return;
    if (this.session.childCount(id) < 2) return;
    const displaced = this.node(this.session.childAt(id, 1));
    const before = displaced.raws.before;
    if (typeof before === 'string' && before.includes('\n')) return;
    displaced.raws.before = '\n';
  }

  /** Match Root#inheritBefore / Root#removeChild raws.before hand-off. */
  private inheritRootBefore(
    parent: number,
    insertedIds: number[],
    sampleId: number | undefined,
    mode: 'prepend' | 'append',
  ): void {
    if (this.snapshots.get(parent)?.type !== 'root' || insertedIds.length === 0) return;
    if (mode === 'prepend') {
      const count = this.session.childCount(parent);
      if (count > insertedIds.length) {
        const displaced = this.node(this.session.childAt(parent, insertedIds.length));
        const next =
          count > insertedIds.length + 1
            ? this.node(this.session.childAt(parent, insertedIds.length + 1))
            : undefined;
        const nextBefore = next?.raws.before;
        if (nextBefore === undefined) delete displaced.raws.before;
        else displaced.raws.before = nextBefore;
      } else {
        for (const id of insertedIds) delete this.node(id).raws.before;
      }
      return;
    }
    if (sampleId === undefined) return;
    const first = this.session.childAt(parent, 0);
    if (first === sampleId) return;
    const before = this.node(sampleId).raws.before;
    for (const id of insertedIds) {
      if (before === undefined) delete this.node(id).raws.before;
      else this.node(id).raws.before = before;
    }
  }

  private syncInferredBetween(childId: number): void {
    this.ensureSnapshot(childId);
    const row = this.snapshots.get(childId);
    if (row?.type !== 'atrule' || this.session.childCount(childId) > 0) return;
    const parent = this.session.parent(childId);
    const sample = parent ? this.findAtRuleBetween(parent, childId) : undefined;
    if (sample === undefined) return;
    this.node(childId).raws.between = sample;
  }

  private findAtRuleBetween(parent: number, skip: number): string | undefined {
    const count = this.session.childCount(parent);
    for (let i = 0; i < count; i++) {
      const sibling = this.session.childAt(parent, i);
      if (sibling === skip) continue;
      this.ensureSnapshot(sibling);
      if (this.snapshots.get(sibling)?.type !== 'atrule') continue;
      const between = this.node(sibling).raws.between;
      if (typeof between === 'string') return between;
      if (this.session.childCount(sibling) === 0) return '';
    }
    return undefined;
  }

  private invalidateTree(id: number): void {
    this.invalidate(id);
    const count = this.session.childCount(id);
    for (let i = 0; i < count; i++) this.invalidateTree(this.session.childAt(id, i));
  }

  private mergeSnapshot(existing: Snapshot | undefined, row: Snapshot): Snapshot {
    if (!existing) return row;
    const localSource = existing.source;
    const localRaws = pickLocalRaws(existing.raws);
    Object.assign(existing, row);
    const localInput = (localSource as { input?: unknown } | undefined)?.input;
    const remoteInput = (row.source as { input?: unknown } | undefined)?.input;
    if (localSource && localInput && !remoteInput) existing.source = localSource;
    else if (localSource && !row.source) existing.source = localSource;
    if (Object.keys(localRaws).length) {
      existing.raws = { ...(existing.raws ?? {}), ...localRaws } as Node['raws'];
    }
    return existing;
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
            if (existing) this.mergeSnapshot(existing, row);
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
                if (childRows[0]) this.mergeSnapshot(known, childRows[0]);
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

function previousMapTextForGo(previous: { text?: string } | undefined): string | undefined {
  const text = previous?.text;
  if (!text) return undefined;
  try {
    const json = JSON.parse(text) as { mappings?: unknown; sections?: unknown };
    if (Array.isArray(json.sections) && json.sections.length > 0) return text;
    if (typeof json.mappings !== 'string' || json.mappings.length === 0) return undefined;
  } catch {
    return undefined;
  }
  return text;
}
