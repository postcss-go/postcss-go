/**
 * Binary AST codec matching `internal/codec`.
 *
 * Two layers share one wire format:
 * - `decodeAst` / `encodeAst` — plain AstDTO trees (API / fallback)
 * - `hydrateAst` / `serializeAst` — live TypeScript AST classes (plugin hot path)
 */

import { AtRule, Comment, Declaration, Document, Node, Root, Rule, type ChildNode } from './ast.js';
import { UnsupportedAstNodeError } from './errors.js';
import type { AstNode, Raws, SourceLocation } from './types.js';

export { assertSupportedAst } from './ast-utils.js';

const MAGIC = Buffer.from('PCGW');
const VERSION = 1;

const TAG_ROOT = 1;
const TAG_DOCUMENT = 2;
const TAG_RULE = 3;
const TAG_AT_RULE = 4;
const TAG_DECL = 5;
const TAG_COMMENT = 6;

const RAW_NULL = 0;
const RAW_STRING = 1;
const RAW_BOOL = 2;
const RAW_RAW_VALUE = 3;
const RAW_INT = 4;
const RAW_FLOAT = 5;
const RAW_MAP = 6;
const RAW_LIST = 7;
class Reader {
  offset = 0;
  constructor(readonly buf: Buffer) {}

  remaining(): number {
    return this.buf.length - this.offset;
  }

  u8(): number {
    if (this.offset >= this.buf.length) throw new Error('codec: truncated byte');
    return this.buf[this.offset++];
  }

  uvarint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = this.u8();
      if (shift <= 28) {
        result |= (byte & 0x7f) << shift;
      } else if (shift <= 48) {
        result += (byte & 0x7f) * 2 ** shift;
      } else {
        throw new Error('codec: uvarint overflow');
      }
      if ((byte & 0x80) === 0) return result;
      shift += 7;
    }
  }

  varint(): number {
    const unsigned = this.uvarint();
    return unsigned & 1 ? ~(unsigned >>> 1) : unsigned >>> 1;
  }

  string(): string {
    const length = this.uvarint();
    if (this.offset + length > this.buf.length) throw new Error('codec: truncated string');
    const value = this.buf.toString('utf8', this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  float64(): number {
    if (this.offset + 8 > this.buf.length) throw new Error('codec: truncated float');
    const value = this.buf.readDoubleBE(this.offset);
    this.offset += 8;
    return value;
  }
}

class Writer {
  private buf = Buffer.allocUnsafe(256);
  private size = 0;

  private ensure(extra: number): void {
    if (this.size + extra <= this.buf.length) return;
    let capacity = this.buf.length;
    while (capacity < this.size + extra) capacity *= 2;
    const next = Buffer.allocUnsafe(capacity);
    this.buf.copy(next, 0, 0, this.size);
    this.buf = next;
  }

  u8(value: number): void {
    this.ensure(1);
    this.buf[this.size++] = value;
  }

  uvarint(value: number | bigint): void {
    if (typeof value === 'number' && value >= 0 && value <= Number.MAX_SAFE_INTEGER) {
      this.ensure(9);
      let n = value;
      while (n >= 0x80) {
        this.buf[this.size++] = (n & 0x7f) | 0x80;
        n = Math.floor(n / 128);
      }
      this.buf[this.size++] = n;
      return;
    }
    let n = typeof value === 'bigint' ? value : BigInt(value);
    this.ensure(10);
    while (n >= 0x80n) {
      this.buf[this.size++] = Number((n & 0x7fn) | 0x80n);
      n >>= 7n;
    }
    this.buf[this.size++] = Number(n);
  }

  varint(value: number): void {
    if (Number.isSafeInteger(value)) {
      const zigzag = value >= 0 ? value * 2 : value * -2 - 1;
      this.uvarint(zigzag);
      return;
    }
    let n = BigInt(value);
    n = n >= 0n ? n << 1n : (n << 1n) ^ -1n;
    this.uvarint(n);
  }

  string(value: string): void {
    const text = value ?? '';
    const byteLength = Buffer.byteLength(text, 'utf8');
    this.uvarint(byteLength);
    this.ensure(byteLength);
    this.buf.write(text, this.size, byteLength, 'utf8');
    this.size += byteLength;
  }

  float64(value: number): void {
    this.ensure(8);
    this.buf.writeDoubleBE(value, this.size);
    this.size += 8;
  }

  write(buf: Buffer): void {
    this.ensure(buf.length);
    buf.copy(this.buf, this.size);
    this.size += buf.length;
  }

  toBuffer(): Buffer {
    return Buffer.from(this.buf.subarray(0, this.size));
  }
}

function decodeRaw(reader: Reader): unknown {
  const tag = reader.u8();
  switch (tag) {
    case RAW_NULL:
      return null;
    case RAW_STRING:
      return reader.string();
    case RAW_BOOL:
      return reader.u8() === 1;
    case RAW_INT:
      return reader.varint();
    case RAW_FLOAT:
      return reader.float64();
    case RAW_RAW_VALUE:
      return { raw: reader.string(), value: reader.string() };
    case RAW_MAP: {
      const count = reader.uvarint();
      const out: Record<string, unknown> = {};
      for (let i = 0; i < count; i += 1) out[reader.string()] = decodeRaw(reader);
      return out;
    }
    case RAW_LIST: {
      const count = reader.uvarint();
      const out: unknown[] = [];
      for (let i = 0; i < count; i += 1) out.push(decodeRaw(reader));
      return out;
    }
    default:
      throw new Error(`codec: unknown raw tag ${tag}`);
  }
}

function decodeRaws(reader: Reader): Raws | undefined {
  const count = reader.uvarint();
  if (count === 0) return undefined;
  const raws: Raws = {};
  for (let i = 0; i < count; i += 1) {
    raws[reader.string()] = decodeRaw(reader) as Raws[string];
  }
  return raws;
}

function decodeSource(reader: Reader): SourceLocation | undefined {
  if (reader.u8() === 0) return undefined;
  const source: SourceLocation & { css?: string; map?: string; mapUrl?: string } = {
    start: { line: reader.varint(), column: reader.varint(), offset: reader.varint() },
    end: { line: reader.varint(), column: reader.varint(), offset: reader.varint() },
  };
  const file = reader.string();
  const css = reader.string();
  const map = reader.string();
  const mapUrl = reader.string();
  if (file) source.file = file;
  if (css) source.css = css;
  if (map) source.map = map;
  if (mapUrl) source.mapUrl = mapUrl;
  return source;
}

function attachChildren<T extends Node>(
  parent: { nodes?: T[]; setParent?(p: unknown): void },
  children: T[],
): void {
  parent.nodes = children;
  for (const child of children) child.setParent?.(parent as never);
}

function hydrateNode(reader: Reader): Node {
  const tag = reader.u8();
  switch (tag) {
    case TAG_ROOT: {
      const raws = decodeRaws(reader);
      const source = decodeSource(reader);
      const root = new Root({ ...(raws ? { raws } : {}), ...(source ? { source } : {}) });
      const count = reader.uvarint();
      const children: ChildNode[] = [];
      for (let i = 0; i < count; i += 1) children.push(hydrateNode(reader) as ChildNode);
      attachChildren(root, children);
      return root;
    }
    case TAG_DOCUMENT: {
      const raws = decodeRaws(reader);
      const source = decodeSource(reader);
      const doc = new Document({ ...(raws ? { raws } : {}), ...(source ? { source } : {}) });
      const count = reader.uvarint();
      const children: Root[] = [];
      for (let i = 0; i < count; i += 1) children.push(hydrateNode(reader) as Root);
      attachChildren(doc, children);
      return doc;
    }
    case TAG_RULE: {
      const selector = reader.string();
      const raws = decodeRaws(reader);
      const source = decodeSource(reader);
      const rule = new Rule({
        selector,
        ...(raws ? { raws } : {}),
        ...(source ? { source } : {}),
      });
      const count = reader.uvarint();
      const children: ChildNode[] = [];
      for (let i = 0; i < count; i += 1) children.push(hydrateNode(reader) as ChildNode);
      attachChildren(rule, children);
      return rule;
    }
    case TAG_AT_RULE: {
      const name = reader.string();
      const params = reader.string();
      const block = reader.u8() === 1;
      const raws = decodeRaws(reader);
      const source = decodeSource(reader);
      const atrule = new AtRule({
        name,
        params,
        ...(block ? { nodes: [] } : {}),
        ...(raws ? { raws } : {}),
        ...(source ? { source } : {}),
      });
      atrule.block = block;
      const count = reader.uvarint();
      if (!block) {
        atrule.nodes = undefined;
        if (count !== 0) throw new Error('codec: non-block atrule has children');
      } else {
        const children: ChildNode[] = [];
        for (let i = 0; i < count; i += 1) children.push(hydrateNode(reader) as ChildNode);
        attachChildren(atrule, children);
      }
      return atrule;
    }
    case TAG_DECL: {
      const prop = reader.string();
      const value = reader.string();
      const important = reader.u8() === 1;
      const raws = decodeRaws(reader);
      const source = decodeSource(reader);
      return new Declaration({
        prop,
        value,
        ...(important ? { important } : {}),
        ...(raws ? { raws } : {}),
        ...(source ? { source } : {}),
      });
    }
    case TAG_COMMENT: {
      const text = reader.string();
      const raws = decodeRaws(reader);
      const source = decodeSource(reader);
      return new Comment({
        text,
        ...(raws ? { raws } : {}),
        ...(source ? { source } : {}),
      });
    }
    default:
      throw new Error(`codec: unknown node tag ${tag}`);
  }
}

function decodeDTONode(reader: Reader): AstNode {
  const tag = reader.u8();
  const node: Record<string, unknown> = {};
  switch (tag) {
    case TAG_ROOT:
      node.type = 'root';
      break;
    case TAG_DOCUMENT:
      node.type = 'document';
      break;
    case TAG_RULE:
      node.type = 'rule';
      node.selector = reader.string();
      break;
    case TAG_AT_RULE:
      node.type = 'atrule';
      node.name = reader.string();
      node.params = reader.string();
      node.block = reader.u8() === 1;
      break;
    case TAG_DECL:
      node.type = 'decl';
      node.prop = reader.string();
      node.value = reader.string();
      node.important = reader.u8() === 1;
      break;
    case TAG_COMMENT:
      node.type = 'comment';
      node.text = reader.string();
      break;
    default:
      throw new Error(`codec: unknown node tag ${tag}`);
  }

  const raws = decodeRaws(reader);
  if (raws) node.raws = raws;
  const source = decodeSource(reader);
  if (source) node.source = source;

  if (tag !== TAG_DECL && tag !== TAG_COMMENT) {
    const count = reader.uvarint();
    // Non-block at-rules encode an empty child list but must not expose `nodes`
    // — that is how PostCSS distinguishes `@import` from `@media {}`.
    if (!(tag === TAG_AT_RULE && !node.block)) {
      const nodes: AstNode[] = [];
      for (let i = 0; i < count; i += 1) nodes.push(decodeDTONode(reader));
      node.nodes = nodes;
    } else if (count !== 0) {
      throw new Error('codec: non-block atrule has children');
    }
  } else if (node.important === false) {
    delete node.important;
  }

  if (node.type === 'atrule' && !node.block) delete node.block;
  return node as unknown as AstNode;
}

function encodeRaw(writer: Writer, value: unknown): void {
  if (value === null || value === undefined) {
    writer.u8(RAW_NULL);
    return;
  }
  if (typeof value === 'string') {
    writer.u8(RAW_STRING);
    writer.string(value);
    return;
  }
  if (typeof value === 'boolean') {
    writer.u8(RAW_BOOL);
    writer.u8(value ? 1 : 0);
    return;
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      writer.u8(RAW_INT);
      writer.varint(value);
    } else {
      writer.u8(RAW_FLOAT);
      writer.float64(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    writer.u8(RAW_LIST);
    writer.uvarint(value.length);
    for (const item of value) encodeRaw(writer, item);
    return;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('raw' in record && 'value' in record && Object.keys(record).length === 2) {
      writer.u8(RAW_RAW_VALUE);
      writer.string(String(record.raw));
      writer.string(String(record.value));
      return;
    }
    const entries = Object.entries(record);
    writer.u8(RAW_MAP);
    writer.uvarint(entries.length);
    for (const [key, item] of entries) {
      writer.string(key);
      encodeRaw(writer, item);
    }
    return;
  }
  throw new Error(`codec: unsupported raw value ${typeof value}`);
}

function encodeRaws(writer: Writer, raws: Raws | undefined): void {
  const entries = Object.entries(raws ?? {});
  writer.uvarint(entries.length);
  for (const [key, value] of entries) {
    writer.string(key);
    encodeRaw(writer, value);
  }
}

function encodeSource(writer: Writer, source: SourceLocation | undefined): void {
  if (!source) {
    writer.u8(0);
    return;
  }
  const extended = source as SourceLocation & {
    css?: string;
    map?: string | Record<string, unknown>;
    mapUrl?: string;
    input?: {
      file?: string;
      from?: string;
      css?: string;
      map?: { file?: string; text?: string; toString?: () => string };
    };
  };
  const inputMap = extended.input?.map;
  const inputMapText =
    typeof inputMap?.text === 'string'
      ? inputMap.text
      : typeof inputMap?.toString === 'function'
        ? inputMap.toString()
        : '';
  const mapText = typeof extended.map === 'string' ? extended.map : inputMapText;
  writer.u8(1);
  writer.varint(source.start.line);
  writer.varint(source.start.column);
  writer.varint(source.start.offset);
  writer.varint(source.end.line);
  writer.varint(source.end.column);
  writer.varint(source.end.offset);
  writer.string(source.file ?? extended.input?.file ?? extended.input?.from ?? '');
  writer.string(extended.css ?? extended.input?.css ?? '');
  writer.string(mapText);
  writer.string(
    mapText
      ? (extended.mapUrl ??
          inputMap?.file ??
          extended.input?.file ??
          extended.input?.from ??
          source.file ??
          '')
      : '',
  );
}

function encodeDTONode(writer: Writer, node: AstNode): void {
  switch (node.type) {
    case 'root':
      writer.u8(TAG_ROOT);
      break;
    case 'document':
      writer.u8(TAG_DOCUMENT);
      break;
    case 'rule':
      writer.u8(TAG_RULE);
      writer.string(node.selector ?? '');
      break;
    case 'atrule':
      writer.u8(TAG_AT_RULE);
      writer.string(node.name ?? '');
      writer.string(node.params ?? '');
      writer.u8(node.block || node.nodes ? 1 : 0);
      break;
    case 'decl':
      writer.u8(TAG_DECL);
      writer.string(node.prop ?? '');
      writer.string(node.value ?? '');
      writer.u8(node.important ? 1 : 0);
      break;
    case 'comment':
      writer.u8(TAG_COMMENT);
      writer.string(node.text ?? '');
      break;
    default:
      throw new UnsupportedAstNodeError(String((node as { type?: unknown }).type));
  }

  encodeRaws(writer, node.raws);
  encodeSource(writer, node.source);

  if (node.type !== 'decl' && node.type !== 'comment') {
    const children = 'nodes' in node && node.nodes ? node.nodes : [];
    writer.uvarint(children.length);
    for (const child of children) encodeDTONode(writer, child as AstNode);
  }
}

function encodeLiveNode(writer: Writer, node: Node): void {
  if (node instanceof Root) {
    writer.u8(TAG_ROOT);
    encodeRaws(writer, node.raws);
    encodeSource(writer, node.source);
    const children = node.nodes ?? [];
    writer.uvarint(children.length);
    for (const child of children) encodeLiveNode(writer, child);
    return;
  }
  if (node instanceof Document) {
    writer.u8(TAG_DOCUMENT);
    encodeRaws(writer, node.raws);
    encodeSource(writer, node.source);
    const children = node.nodes ?? [];
    writer.uvarint(children.length);
    for (const child of children) encodeLiveNode(writer, child);
    return;
  }
  if (node instanceof Rule) {
    writer.u8(TAG_RULE);
    writer.string(node.selector ?? '');
    encodeRaws(writer, node.raws);
    encodeSource(writer, node.source);
    const children = node.nodes ?? [];
    writer.uvarint(children.length);
    for (const child of children) encodeLiveNode(writer, child);
    return;
  }
  if (node instanceof AtRule) {
    writer.u8(TAG_AT_RULE);
    writer.string(node.name ?? '');
    writer.string(node.params ?? '');
    const hasBlock = node.block || node.nodes !== undefined;
    writer.u8(hasBlock ? 1 : 0);
    encodeRaws(writer, node.raws);
    encodeSource(writer, node.source);
    const children = hasBlock ? (node.nodes ?? []) : [];
    writer.uvarint(children.length);
    for (const child of children) encodeLiveNode(writer, child);
    return;
  }
  if (node instanceof Declaration) {
    writer.u8(TAG_DECL);
    writer.string(node.prop ?? '');
    writer.string(node.value ?? '');
    writer.u8(node.important ? 1 : 0);
    encodeRaws(writer, node.raws);
    encodeSource(writer, node.source);
    return;
  }
  if (node instanceof Comment) {
    writer.u8(TAG_COMMENT);
    writer.string(node.text ?? '');
    encodeRaws(writer, node.raws);
    encodeSource(writer, node.source);
    return;
  }
  throw new UnsupportedAstNodeError(node.type);
}

function openReader(buffer: Buffer | Uint8Array): Reader {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 5 || !buf.subarray(0, 4).equals(MAGIC) || buf[4] !== VERSION) {
    throw new Error('codec: bad magic or version');
  }
  const reader = new Reader(buf);
  reader.offset = 5;
  return reader;
}

/** Decode a binary AST Buffer into a plain AstDTO root. */
export function decodeAst(buffer: Buffer | Uint8Array): AstNode {
  const reader = openReader(buffer);
  const root = decodeDTONode(reader);
  if (reader.remaining() !== 0) throw new Error('codec: trailing bytes');
  return root;
}

/** Encode a plain AstDTO root into a binary Buffer. */
export function encodeAst(root: AstNode): Buffer {
  const writer = new Writer();
  writer.write(MAGIC);
  writer.u8(VERSION);
  encodeDTONode(writer, root);
  return writer.toBuffer();
}

/**
 * Decode a binary AST Buffer straight into live TypeScript AST classes,
 * skipping the intermediate plain DTO that `decodeAst` + `fromAst` would build.
 */
export function hydrateAst(buffer: Buffer | Uint8Array): Root {
  const reader = openReader(buffer);
  const root = hydrateNode(reader);
  if (reader.remaining() !== 0) throw new Error('codec: trailing bytes');
  if (!(root instanceof Root)) {
    throw new Error('codec: hydrateAst expected a root node');
  }
  return root;
}

/**
 * Encode a live TypeScript AST node into the binary codec, skipping `toAst`.
 */
export function serializeAst(root: Node): Buffer {
  const writer = new Writer();
  writer.write(MAGIC);
  writer.u8(VERSION);
  encodeLiveNode(writer, root);
  return writer.toBuffer();
}
