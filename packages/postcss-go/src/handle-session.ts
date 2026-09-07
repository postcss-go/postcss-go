import {
  HANDLE_PROTOCOL_MAJOR,
  HANDLE_REQUIRED_CAPABILITIES,
  HANDLE_MAX_BATCH_SIZE,
  HANDLE_FIELD_PROP,
  HANDLE_FIELD_VALUE,
  HANDLE_FIELD_SELECTOR,
  HANDLE_FIELD_NAME,
  HANDLE_FIELD_PARAMS,
  HANDLE_FIELD_TEXT,
} from './generated/handle-protocol.js';
export {
  HANDLE_FIELD_PROP,
  HANDLE_FIELD_VALUE,
  HANDLE_FIELD_SELECTOR,
  HANDLE_FIELD_NAME,
  HANDLE_FIELD_PARAMS,
  HANDLE_FIELD_TEXT,
};

export type HandleField =
  | typeof HANDLE_FIELD_PROP
  | typeof HANDLE_FIELD_VALUE
  | typeof HANDLE_FIELD_SELECTOR
  | typeof HANDLE_FIELD_NAME
  | typeof HANDLE_FIELD_PARAMS
  | typeof HANDLE_FIELD_TEXT;

export type NativeHandleAddon = {
  handleProtocolInfo(): {
    major: number;
    minor: number;
    maxBatchSize: number;
    capabilities: Uint32Array;
  };
  handleParseV2(css: string): { sessionId: number; rootId: number };
  handleCloseV2(sessionId: number): void;
  handleTypeV2(sessionId: number, handle: number): number;
  handleGetFieldV2(sessionId: number, handle: number, field: HandleField): string;
  handleSetFieldV2(sessionId: number, handle: number, field: HandleField, value: string): void;
  handleWalkDeclsV2(sessionId: number, root: number, buffer: Uint32Array): number;
  handleOpenCursorV2(sessionId: number, root: number, declsOnly?: boolean): number;
  handleCursorNextV2(sessionId: number, cursor: number, buffer: Uint32Array): number;
  handleCloseCursorV2(sessionId: number, cursor: number): void;
  handleReadFieldsV2(sessionId: number, handles: Uint32Array, field: HandleField): string[];
  handleSetFieldsV2(
    sessionId: number,
    handles: Uint32Array,
    field: HandleField,
    values: string[],
  ): void;
  handleStringifyV2(sessionId: number, handle: number): string;
  handleNewDeclV2(sessionId: number, prop: string, value: string): number;
  handleAppendV2(sessionId: number, parent: number, child: number): void;
  handleDisposeV2(sessionId: number, handle: number): void;
};

function negotiateNativeHandleBridge(addon: unknown): number | undefined {
  if (!addon || typeof addon !== 'object') return undefined;
  const candidate = addon as NativeHandleAddon;
  const methods = [
    'handleProtocolInfo',
    'handleParseV2',
    'handleCloseV2',
    'handleTypeV2',
    'handleGetFieldV2',
    'handleSetFieldV2',
    'handleWalkDeclsV2',
    'handleOpenCursorV2',
    'handleCursorNextV2',
    'handleCloseCursorV2',
    'handleReadFieldsV2',
    'handleSetFieldsV2',
    'handleStringifyV2',
    'handleNewDeclV2',
    'handleAppendV2',
    'handleDisposeV2',
  ] as const;
  if (!methods.every((name) => typeof candidate[name] === 'function')) return undefined;
  try {
    const info = candidate.handleProtocolInfo();
    if (
      info?.major !== HANDLE_PROTOCOL_MAJOR ||
      !Number.isInteger(info.minor) ||
      info.minor < 0 ||
      !(info.capabilities instanceof Uint32Array) ||
      !HANDLE_REQUIRED_CAPABILITIES.every(
        (required, index) => (info.capabilities[index] & required) >>> 0 === required,
      ) ||
      !Number.isSafeInteger(info.maxBatchSize) ||
      info.maxBatchSize < 1 ||
      info.maxBatchSize > 0xffffffff
    )
      return undefined;
    return Math.min(info.maxBatchSize, HANDLE_MAX_BATCH_SIZE);
  } catch {
    // Version-skewed addons must leave the existing binary bridge usable.
    return undefined;
  }
}

export function hasNativeHandleBridge(addon: unknown): addon is NativeHandleAddon {
  return negotiateNativeHandleBridge(addon) !== undefined;
}

/** Opaque Go AST session backed by stable numeric handles. */
export class NativeHandleSession {
  walkBuffer: Uint32Array;
  private root = 0;
  private readonly maxBatchSize: number;
  private owner?: { sessionId: number; rootId: number };

  constructor(
    private readonly addon: NativeHandleAddon,
    walkCapacity = HANDLE_MAX_BATCH_SIZE,
  ) {
    if (!Number.isSafeInteger(walkCapacity) || walkCapacity < 1)
      throw new RangeError('walk capacity must be positive');
    const maxBatchSize = negotiateNativeHandleBridge(addon);
    if (maxBatchSize === undefined) throw new Error('incompatible native handle protocol');
    this.maxBatchSize = maxBatchSize;
    this.walkBuffer = new Uint32Array(walkCapacity);
  }

  parse(css: string): number {
    this.close();
    const created = this.addon.handleParseV2(css);
    if (!created?.sessionId || !created.rootId) throw new Error('postcss-go handle parse failed');
    this.owner = created;
    this.root = created.rootId;
    return this.root;
  }

  get rootHandle(): number {
    return this.root;
  }

  getField(handle: number, field: HandleField): string {
    return this.addon.handleGetFieldV2(this.requireSession(), handle, field);
  }

  setField(handle: number, field: HandleField, value: string): void {
    this.addon.handleSetFieldV2(this.requireSession(), handle, field, value);
  }

  walkDecls(root = this.root): number {
    return this.cursorWalkDecls(root);
  }

  cursorWalkDecls(root = this.root): number {
    const cursor = this.addon.handleOpenCursorV2(this.requireSession(), root, true);
    try {
      let count = 0;
      for (;;) {
        const target = this.walkBuffer.subarray(count, count + this.maxBatchSize);
        const read = this.addon.handleCursorNextV2(this.requireSession(), cursor, target);
        if (!Number.isInteger(read) || read < 0 || read > target.length)
          throw new Error('invalid handle cursor page');
        count += read;
        if (read < target.length) return count;
        if (count === this.walkBuffer.length) {
          const grown = new Uint32Array(this.walkBuffer.length * 2);
          grown.set(this.walkBuffer);
          this.walkBuffer = grown;
        }
      }
    } finally {
      this.addon.handleCloseCursorV2(this.requireSession(), cursor);
    }
  }

  readFields(handles: Uint32Array, field: HandleField): string[] {
    this.validateBatchSize(handles);
    return this.addon.handleReadFieldsV2(this.requireSession(), handles, field);
  }

  /** Snapshot cursor for the restricted scalar-only runtime, not structural walks. */
  *declarationBatches(): Generator<Uint32Array> {
    const id = this.requireSession();
    const cursor = this.addon.handleOpenCursorV2(id, this.root, true);
    const buffer = new Uint32Array(this.maxBatchSize);
    try {
      for (;;) {
        const count = this.addon.handleCursorNextV2(id, cursor, buffer);
        if (!Number.isInteger(count) || count < 0 || count > buffer.length)
          throw new Error('invalid handle cursor page');
        if (count === 0) return;
        yield buffer.subarray(0, count);
      }
    } finally {
      this.addon.handleCloseCursorV2(id, cursor);
    }
  }

  setFields(handles: Uint32Array, field: HandleField, values: string[]): void {
    this.validateBatchSize(handles);
    this.addon.handleSetFieldsV2(this.requireSession(), handles, field, values);
  }

  stringify(handle = this.root): string {
    return this.addon.handleStringifyV2(this.requireSession(), handle);
  }

  private validateBatchSize(handles: Uint32Array): void {
    // Do not split writes: a rejected batch must remain atomic.
    if (handles.length > this.maxBatchSize)
      throw new RangeError('handle batch exceeds negotiated maximum');
  }

  private requireSession(): number {
    if (!this.owner) throw new Error('postcss-go handle session closed');
    return this.owner.sessionId;
  }

  close(): void {
    if (!this.owner) return;
    const id = this.owner.sessionId;
    this.owner = undefined;
    this.root = 0;
    this.addon.handleCloseV2(id);
  }
}

export type HandleDeclarationStub = {
  prop: string;
  value: string;
  important: boolean;
};

/** Thrown when a declaration-only handle stub is used beyond prop/value writes. */
export class HandleDeclarationUnsupportedError extends Error {
  readonly property: string;

  constructor(property: string) {
    super(`handle declaration stub does not support '${property}'`);
    this.name = 'HandleDeclarationUnsupportedError';
    this.property = property;
  }
}

const HANDLE_DECLARATION_STUB_KEYS = new Set(['prop', 'value']);

export function createHandleDeclarationStub(prop: string, value: string): HandleDeclarationStub {
  const target: HandleDeclarationStub = { prop, value, important: false };
  return new Proxy(target, {
    get(obj, key) {
      if (typeof key === 'symbol') return Reflect.get(obj, key);
      if (HANDLE_DECLARATION_STUB_KEYS.has(key)) return obj[key as 'prop' | 'value'];
      throw new HandleDeclarationUnsupportedError(key);
    },
    set(obj, key, next) {
      if (typeof key === 'string' && HANDLE_DECLARATION_STUB_KEYS.has(key)) {
        obj[key as 'prop' | 'value'] = String(next);
        return true;
      }
      throw new HandleDeclarationUnsupportedError(String(key));
    },
  });
}
