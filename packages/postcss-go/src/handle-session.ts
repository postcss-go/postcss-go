export const HANDLE_FIELD_PROP = 0;
export const HANDLE_FIELD_VALUE = 1;
export const HANDLE_FIELD_SELECTOR = 2;
export const HANDLE_FIELD_NAME = 3;
export const HANDLE_FIELD_PARAMS = 4;
export const HANDLE_FIELD_TEXT = 5;

export type HandleField =
  | typeof HANDLE_FIELD_PROP
  | typeof HANDLE_FIELD_VALUE
  | typeof HANDLE_FIELD_SELECTOR
  | typeof HANDLE_FIELD_NAME
  | typeof HANDLE_FIELD_PARAMS
  | typeof HANDLE_FIELD_TEXT;

export type NativeHandleAddon = {
  handleParse(css: string): number;
  handleClose(): void;
  handleType(handle: number): number;
  handleGetField(handle: number, field: HandleField): string;
  handleSetField(handle: number, field: HandleField, value: string): void;
  handleWalkDecls(root: number, buffer: Uint32Array): number;
  handleOpenCursor(root: number, declsOnly?: boolean): number;
  handleCursorNext(cursor: number, buffer: Uint32Array): number;
  handleCloseCursor(cursor: number): void;
  handleReadFields(handles: Uint32Array, field: HandleField): string[];
  handleSetFields(handles: Uint32Array, field: HandleField, values: string[]): void;
  handleStringify(handle: number): string;
  handleNewDecl(prop: string, value: string): number;
  handleAppend(parent: number, child: number): void;
  handleDispose(handle: number): void;
};

export function hasNativeHandleBridge(addon: unknown): addon is NativeHandleAddon {
  if (!addon || typeof addon !== 'object') return false;
  const candidate = addon as NativeHandleAddon;
  return (
    typeof candidate.handleParse === 'function' &&
    typeof candidate.handleStringify === 'function' &&
    typeof candidate.handleReadFields === 'function' &&
    typeof candidate.handleSetFields === 'function'
  );
}

/** Opaque Go AST session backed by stable numeric handles. */
export class NativeHandleSession {
  readonly walkBuffer: Uint32Array;
  private root = 0;
  private closed = false;

  constructor(
    private readonly addon: NativeHandleAddon,
    walkCapacity = 200_000,
  ) {
    this.walkBuffer = new Uint32Array(walkCapacity);
  }

  parse(css: string): number {
    this.close();
    const root = this.addon.handleParse(css);
    if (!root) throw new Error('postcss-go handle parse failed');
    this.root = root;
    return root;
  }

  get rootHandle(): number {
    return this.root;
  }

  getField(handle: number, field: HandleField): string {
    return this.addon.handleGetField(handle, field);
  }

  setField(handle: number, field: HandleField, value: string): void {
    this.addon.handleSetField(handle, field, value);
  }

  walkDecls(root = this.root): number {
    return this.addon.handleWalkDecls(root, this.walkBuffer);
  }

  cursorWalkDecls(root = this.root): number {
    const cursor = this.addon.handleOpenCursor(root, true);
    try {
      return this.addon.handleCursorNext(cursor, this.walkBuffer);
    } finally {
      this.addon.handleCloseCursor(cursor);
    }
  }

  readFields(handles: Uint32Array, field: HandleField): string[] {
    return this.addon.handleReadFields(handles, field);
  }

  setFields(handles: Uint32Array, field: HandleField, values: string[]): void {
    this.addon.handleSetFields(handles, field, values);
  }

  stringify(handle = this.root): string {
    return this.addon.handleStringify(handle);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.root = 0;
    this.addon.handleClose();
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
