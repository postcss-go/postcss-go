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
  HANDLE_FIELD_IMPORTANT,
  HANDLE_STATUS_PARSE,
} from './generated/handle-protocol.js';
import { CssSyntaxError, cssSyntaxErrorFromDto, type CssSyntaxErrorDTO } from './errors.js';
export {
  HANDLE_FIELD_PROP,
  HANDLE_FIELD_VALUE,
  HANDLE_FIELD_SELECTOR,
  HANDLE_FIELD_NAME,
  HANDLE_FIELD_PARAMS,
  HANDLE_FIELD_TEXT,
  HANDLE_FIELD_IMPORTANT,
};

export type HandleField =
  | typeof HANDLE_FIELD_PROP
  | typeof HANDLE_FIELD_VALUE
  | typeof HANDLE_FIELD_SELECTOR
  | typeof HANDLE_FIELD_NAME
  | typeof HANDLE_FIELD_PARAMS
  | typeof HANDLE_FIELD_TEXT
  | typeof HANDLE_FIELD_IMPORTANT;

export type HandleParseOptions = {
  from?: string;
  document?: string;
  trackSource?: boolean;
  /** Resolved previous map text, so Go owns origin lookups for composition. */
  sourceMap?: string;
  sourceMapUrl?: string;
};

/** Bridge failures carry a generated HANDLE_STATUS_* value and a Go-owned message. */
export type HandleBridgeError = Error & { status: number };

/**
 * Runtime-neutral handle transport. Implemented by the Node-API addon and by
 * the browser main-thread WASM exports; the AST never leaves the Go arena.
 */
export type HandleBridge = {
  handleProtocolInfo(): {
    major: number;
    minor: number;
    maxBatchSize: number;
    capabilities: Uint32Array;
  };
  handleParse(css: string, optionsJSON?: string): { sessionId: number; rootId: number };
  handleReadSnapshots?(sessionId: number, handles: Uint32Array): string;
  handleClose(sessionId: number): void;
  handleType(sessionId: number, handle: number): number;
  handleGetField(sessionId: number, handle: number, field: HandleField): string;
  handleSetField(sessionId: number, handle: number, field: HandleField, value: string): void;
  handleWalkDecls(sessionId: number, root: number, buffer: Uint32Array): number;
  handleOpenCursor(sessionId: number, root: number, declsOnly?: boolean): number;
  handleCursorNext(sessionId: number, cursor: number, buffer: Uint32Array): number;
  handleCloseCursor(sessionId: number, cursor: number): void;
  handleReadFields(sessionId: number, handles: Uint32Array, field: HandleField): string[];
  handleSetFields(
    sessionId: number,
    handles: Uint32Array,
    field: HandleField,
    values: string[],
  ): void;
  handleApplyPatches?(
    sessionId: number,
    handles: Uint32Array,
    fields: Int32Array,
    values: string[],
  ): void;
  handleStringify(sessionId: number, handle: number): string;
  handleNewDecl(sessionId: number, prop: string, value: string): number;
  handleAppend(sessionId: number, parent: number, child: number): void;
  handleDispose(sessionId: number, handle: number): void;
  handleInsertBefore?(sessionId: number, target: number, child: number): void;
  handleRemove?(sessionId: number, handle: number): void;
  handleClone?(sessionId: number, handle: number): number;
  handlePrepend?(sessionId: number, parent: number, child: number): void;
  handleInsertAfter?(sessionId: number, target: number, child: number): void;
  handleReplaceWith?(sessionId: number, target: number, handles: Uint32Array): void;
  handleNewRule?(sessionId: number, selector: string): number;
  handleNewAtRule?(sessionId: number, name: string, params: string): number;
  handleNewComment?(sessionId: number, text: string): number;
  handleSetRaw?(sessionId: number, handle: number, patchJSON: string): void;
  handleGetRaws?(sessionId: number, handle: number): string;
  handleStringifyMap?(sessionId: number, handle: number, optionsJSON?: string): string;
  handleParent?(sessionId: number, handle: number): number;
  handleChildCount?(sessionId: number, handle: number): number;
  handleChildAt?(sessionId: number, handle: number, index: number): number;
  handleStringifyBuilder?(sessionId: number, handle: number): string;
  handleQuery?(sessionId: number, handle: number, kind: string, optionsJSON?: string): string;
};

/** Deprecated runtime-specific aliases kept for the migration window. */
export type NativeHandleParseOptions = HandleParseOptions;
export type NativeHandleError = HandleBridgeError;
export type NativeHandleAddon = HandleBridge;

function negotiateHandleBridge(bridge: unknown): number | undefined {
  if (!bridge || typeof bridge !== 'object') return undefined;
  const candidate = bridge as HandleBridge;
  const methods = [
    'handleProtocolInfo',
    'handleParse',
    'handleClose',
    'handleType',
    'handleGetField',
    'handleSetField',
    'handleWalkDecls',
    'handleOpenCursor',
    'handleCursorNext',
    'handleCloseCursor',
    'handleReadFields',
    'handleSetFields',
    'handleStringify',
    'handleNewDecl',
    'handleAppend',
    'handleDispose',
  ] as const;
  try {
    if (!methods.every((name) => typeof candidate[name] === 'function')) return undefined;
    const info = candidate.handleProtocolInfo();
    if (
      info?.major !== HANDLE_PROTOCOL_MAJOR ||
      !Number.isInteger(info.minor) ||
      info.minor < 0 ||
      info.minor > 0xffffffff ||
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
    // A version-skewed bridge must fail negotiation rather than be used.
    return undefined;
  }
}

export function hasHandleBridge(bridge: unknown): bridge is HandleBridge {
  return negotiateHandleBridge(bridge) !== undefined;
}

/** Deprecated runtime-specific alias kept for the migration window. */
export const hasNativeHandleBridge = hasHandleBridge;

/** Opaque Go AST session backed by stable numeric handles. */
export class HandleSession {
  walkBuffer: Uint32Array;
  private root = 0;
  private readonly maxBatchSize: number;
  private owner?: { sessionId: number; rootId: number };

  constructor(
    private readonly bridge: HandleBridge,
    walkCapacity = HANDLE_MAX_BATCH_SIZE,
  ) {
    if (!Number.isSafeInteger(walkCapacity) || walkCapacity < 1)
      throw new RangeError('walk capacity must be positive');
    const maxBatchSize = negotiateHandleBridge(bridge);
    if (maxBatchSize === undefined) throw new Error('incompatible native handle protocol');
    this.maxBatchSize = maxBatchSize;
    this.walkBuffer = new Uint32Array(walkCapacity);
  }

  parse(css: string, options?: HandleParseOptions): number {
    this.close();
    let created: { sessionId: number; rootId: number };
    try {
      created =
        options === undefined
          ? this.bridge.handleParse(css)
          : this.bridge.handleParse(css, JSON.stringify(options));
    } catch (error) {
      throw wrapHandleParseError(error, css, options?.from);
    }
    const validId = (id: number) => Number.isInteger(id) && id > 0 && id <= 0xffffffff;
    if (!created || !validId(created.sessionId) || !validId(created.rootId)) {
      if (created && validId(created.sessionId)) this.bridge.handleClose(created.sessionId);
      throw new Error('postcss-go handle parse failed');
    }
    this.owner = created;
    this.root = created.rootId;
    return this.root;
  }

  get rootHandle(): number {
    return this.root;
  }

  /** Arena id, for lifetime owners that must close without holding the session. */
  get sessionId(): number | undefined {
    return this.owner?.sessionId;
  }

  get handleBridge(): HandleBridge {
    return this.bridge;
  }

  getField(handle: number, field: HandleField): string {
    return this.bridge.handleGetField(this.requireSession(), handle, field);
  }

  setField(handle: number, field: HandleField, value: string): void {
    this.bridge.handleSetField(this.requireSession(), handle, field, value);
  }

  walkDecls(root = this.root): number {
    return this.cursorWalkDecls(root);
  }

  cursorWalkDecls(root = this.root): number {
    const cursor = this.bridge.handleOpenCursor(this.requireSession(), root, true);
    try {
      let count = 0;
      for (;;) {
        const target = this.walkBuffer.subarray(count, count + this.maxBatchSize);
        const read = this.bridge.handleCursorNext(this.requireSession(), cursor, target);
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
      this.bridge.handleCloseCursor(this.requireSession(), cursor);
    }
  }

  readFields(handles: Uint32Array, field: HandleField): string[] {
    this.validateBatchSize(handles);
    return this.bridge.handleReadFields(this.requireSession(), handles, field);
  }

  /** Compatibility entry point for the isolated scalar prototype. */
  *declarationBatches(): Generator<Uint32Array> {
    yield* this.nodeBatches(true);
  }

  /** Bounded snapshot pages; mutation-aware traversal is a later capability. */
  *nodeBatches(declsOnly = false): Generator<Uint32Array> {
    const id = this.requireSession();
    const cursor = this.bridge.handleOpenCursor(id, this.root, declsOnly);
    const buffer = new Uint32Array(this.maxBatchSize);
    try {
      for (;;) {
        const count = this.bridge.handleCursorNext(id, cursor, buffer);
        if (!Number.isInteger(count) || count < 0 || count > buffer.length)
          throw new Error('invalid handle cursor page');
        if (count === 0) return;
        yield buffer.subarray(0, count);
      }
    } finally {
      this.bridge.handleCloseCursor(id, cursor);
    }
  }

  readSnapshots(handles: Uint32Array): string {
    this.validateBatchSize(handles);
    if (!this.bridge.handleReadSnapshots)
      throw new HandleDeclarationUnsupportedError('snapshot capability');
    return this.bridge.handleReadSnapshots(this.requireSession(), handles);
  }

  setFields(handles: Uint32Array, field: HandleField, values: string[]): void {
    this.validateBatchSize(handles);
    this.bridge.handleSetFields(this.requireSession(), handles, field, values);
  }

  /** Ordered mixed-field scalar writes; Go validates the whole batch before commit. */
  applyPatches(handles: Uint32Array, fields: Int32Array, values: string[]): void {
    this.validateBatchSize(handles);
    if (handles.length !== fields.length || handles.length !== values.length)
      throw new RangeError('handle mutation batch length mismatch');
    if (!this.bridge.handleApplyPatches)
      throw new HandleDeclarationUnsupportedError('atomic patches capability');
    this.bridge.handleApplyPatches(this.requireSession(), handles, fields, values);
  }

  stringify(handle = this.root): string {
    return this.bridge.handleStringify(this.requireSession(), handle);
  }

  stringifyMap(
    handle = this.root,
    options: Record<string, unknown> = {},
  ): { css: string; map: string } {
    if (!this.bridge.handleStringifyMap)
      throw new HandleDeclarationUnsupportedError('source maps capability');
    const payload = JSON.parse(
      this.bridge.handleStringifyMap(this.requireSession(), handle, JSON.stringify(options)),
    ) as { css: string; map: string };
    return payload;
  }

  insertBefore(target: number, child: number): void {
    this.requireMutation('handleInsertBefore')(this.requireSession(), target, child);
  }

  remove(handle: number): void {
    this.requireMutation('handleRemove')(this.requireSession(), handle);
  }

  clone(handle: number): number {
    return this.requireMutation('handleClone')(this.requireSession(), handle);
  }

  prepend(parent: number, child: number): void {
    this.requireMutation('handlePrepend')(this.requireSession(), parent, child);
  }

  insertAfter(target: number, child: number): void {
    this.requireMutation('handleInsertAfter')(this.requireSession(), target, child);
  }

  replaceWith(target: number, handles: Uint32Array): void {
    this.requireMutation('handleReplaceWith')(this.requireSession(), target, handles);
  }

  append(parent: number, child: number): void {
    this.bridge.handleAppend(this.requireSession(), parent, child);
  }

  newDecl(prop: string, value: string): number {
    return this.bridge.handleNewDecl(this.requireSession(), prop, value);
  }

  newRule(selector: string): number {
    return this.requireMutation('handleNewRule')(this.requireSession(), selector);
  }

  newAtRule(name: string, params: string): number {
    return this.requireMutation('handleNewAtRule')(this.requireSession(), name, params);
  }

  newComment(text: string): number {
    return this.requireMutation('handleNewComment')(this.requireSession(), text);
  }

  setRaw(handle: number, patch: { key: string; kind: string; value?: unknown }): void {
    this.requireMutation('handleSetRaw')(this.requireSession(), handle, JSON.stringify(patch));
  }

  getRaws(handle: number): Record<string, unknown> {
    const json = this.requireMutation('handleGetRaws')(this.requireSession(), handle);
    return JSON.parse(json) as Record<string, unknown>;
  }

  parent(handle: number): number {
    return this.requireMutation('handleParent')(this.requireSession(), handle);
  }

  childCount(handle: number): number {
    return this.requireMutation('handleChildCount')(this.requireSession(), handle);
  }

  childAt(handle: number, index: number): number {
    return this.requireMutation('handleChildAt')(this.requireSession(), handle, index);
  }

  stringifyBuilder(handle: number): Array<{ css: string; node?: number; type?: string }> {
    const json = this.requireMutation('handleStringifyBuilder')(this.requireSession(), handle);
    return JSON.parse(json) as Array<{ css: string; node?: number; type?: string }>;
  }

  query<T>(handle: number, kind: string, options: Record<string, unknown> = {}): T {
    const json = this.requireMutation('handleQuery')(
      this.requireSession(),
      handle,
      kind,
      JSON.stringify(options),
    );
    return JSON.parse(json) as T;
  }

  private requireMutation<K extends keyof HandleBridge>(name: K): NonNullable<HandleBridge[K]> {
    const method = this.bridge[name];
    if (typeof method !== 'function') throw new HandleDeclarationUnsupportedError(String(name));
    return method.bind(this.bridge) as NonNullable<HandleBridge[K]>;
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
    this.bridge.handleClose(id);
  }
}

function wrapHandleParseError(error: unknown, css: string, file?: string): never {
  const status =
    error && typeof error === 'object' ? Number((error as { status?: number }).status) : NaN;
  const message = error instanceof Error ? error.message : String(error);
  const prefix = 'postcss-go:css-syntax:';
  const prefixedAt = message.indexOf(prefix);
  if (prefixedAt >= 0) {
    const payload = message.slice(prefixedAt + prefix.length).trim();
    const fallback = { source: css, file };
    if (payload.startsWith('{')) {
      try {
        throw cssSyntaxErrorFromDto(JSON.parse(payload) as CssSyntaxErrorDTO, fallback);
      } catch (cause) {
        if (cause instanceof CssSyntaxError) throw cause;
        throw new CssSyntaxError(payload, fallback);
      }
    }
    throw new CssSyntaxError(payload, fallback);
  }
  if (status !== HANDLE_STATUS_PARSE) throw error;
  const stripped = message
    .replace(/^asthandle:\s*parse failed:\s*/i, '')
    .replace(/^CssSyntaxError:\s*/i, '');
  const located = stripped.match(/^(.*):(\d+):(\d+):\s*(.*)$/s);
  if (located) {
    const locatedFile = located[1] && located[1] !== '<css input>' ? located[1] : file;
    const reason = located[4]?.trim() || stripped;
    throw new CssSyntaxError(reason, {
      source: css,
      file: locatedFile,
      line: Number(located[2]),
      column: Number(located[3]),
    });
  }
  throw new CssSyntaxError(stripped || message, { source: css, file });
}

/** Deprecated runtime-specific alias kept for the migration window. */
export const NativeHandleSession = HandleSession;

export type HandleDeclarationStub = {
  prop: string;
  value: string;
  important: boolean;
};

/** Thrown when a declaration-only handle stub is used beyond prop/value writes. */
export class HandleDeclarationUnsupportedError extends Error {
  readonly property: string;

  constructor(property: string) {
    super(`native handle runtime does not support '${property}'`);
    this.name = 'HandleDeclarationUnsupportedError';
    this.property = property;
  }
}

const HANDLE_DECLARATION_STUB_KEYS = new Set(['prop', 'value', 'important']);

export function createHandleDeclarationStub(
  prop: string,
  value: string,
  important = false,
): HandleDeclarationStub {
  const target: HandleDeclarationStub = { prop, value, important };
  return new Proxy(target, {
    get(obj, key) {
      if (typeof key === 'symbol') return Reflect.get(obj, key);
      if (HANDLE_DECLARATION_STUB_KEYS.has(key)) return obj[key as keyof HandleDeclarationStub];
      throw new HandleDeclarationUnsupportedError(key);
    },
    set(obj, key, next) {
      if (key === 'important') {
        obj.important = Boolean(next);
        return true;
      }
      if (typeof key === 'string' && (key === 'prop' || key === 'value')) {
        obj[key] = String(next);
        return true;
      }
      throw new HandleDeclarationUnsupportedError(String(key));
    },
  });
}
