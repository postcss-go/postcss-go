import type { Node } from './ast.js';
import { UnsupportedAstNodeError } from './errors.js';
import type { AstNode, RawField, Raws, SourceLocation } from './types.js';

const BUILTIN_NODE_TYPES = new Set(['root', 'document', 'rule', 'atrule', 'decl', 'comment']);

export const INTERNAL_NODE_PROPERTIES = new Set([
  'indexes',
  'lastEach',
  'parent',
  'proxyCache',
  'rawsProvided',
]);

/** Validate a tree before JSON, binary, native, or WASM transport. */
export function assertSupportedAst(node: AstNode | Node): void {
  if (!BUILTIN_NODE_TYPES.has(node.type)) throw new UnsupportedAstNodeError(node.type);
  const children = (node as AstNode & { nodes?: AstNode[] }).nodes;
  for (const child of children ?? []) assertSupportedAst(child);
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

export function cloneRaws(raws: Raws | undefined): Raws {
  const result: Raws = {};
  for (const [key, value] of Object.entries(raws ?? {})) result[key] = cloneRaw(value);
  return result;
}

export function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') {
    const cloned = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>;
    for (const [name, child] of Object.entries(value)) cloned[name] = cloneValue(child);
    return cloned;
  }
  return value;
}

export function finishJSON(
  value: Record<string, unknown>,
  inputs: Map<unknown, number> | undefined,
  sharedInputs: Map<unknown, number>,
): Record<string, unknown> {
  if (inputs === undefined) {
    value.inputs = [...sharedInputs.keys()].map((input) => serializeJSONValue(input));
  }
  return value;
}

export function rawValue(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value) && 'raw' in value) {
    const rawValue = value as { raw: unknown; value?: unknown };
    if (rawValue.value === undefined || String(rawValue.value) === fallback) {
      return String(rawValue.raw);
    }
  }
  return fallback;
}

export function removeSource(node: AstNode): void {
  delete node.source;
  if ('nodes' in node && node.nodes) {
    for (const child of node.nodes) removeSource(child);
  }
}

/**
 * The bridge DTO omits empty node lists, so an explicit `block` flag is the only way Go can tell
 * `@media x {}` from `@import "y"`. PostCSS-shaped JSON encodes that as `nodes: []` instead.
 */
export function markBridgeBlocks(node: AstNode): void {
  if (node.type === 'atrule' && node.nodes !== undefined) node.block = true;
  if ('nodes' in node && node.nodes) {
    for (const child of node.nodes) markBridgeBlocks(child);
  }
}

export function restoreBridgeSources(node: AstNode, inputs: readonly unknown[]): void {
  const source = node.source as (SourceLocation & { inputId?: number }) | undefined;
  if (source?.inputId !== undefined) {
    const input = inputs[source.inputId] as
      | {
          css?: unknown;
          file?: unknown;
          from?: unknown;
          map?: { file?: unknown; text?: unknown; toString?: () => string };
        }
      | undefined;
    const mapText =
      typeof input?.map?.text === 'string'
        ? input.map.text
        : typeof input?.map?.toString === 'function'
          ? input.map.toString()
          : undefined;
    const { inputId: _inputId, input: _input, ...position } = source;
    node.source = {
      ...position,
      ...(input?.from || input?.file ? { file: String(input.from ?? input.file) } : {}),
      ...(typeof input?.css === 'string' ? { css: input.css } : {}),
      ...(mapText ? { map: mapText } : {}),
      ...(mapText ? { mapUrl: String(input?.map?.file ?? input?.file ?? input?.from ?? '') } : {}),
    };
  }
  if ('nodes' in node && node.nodes) {
    for (const child of node.nodes) restoreBridgeSources(child, inputs);
  }
}

export function serializeJSONValue(value: unknown, inputs?: Map<unknown, number>): unknown {
  if (Array.isArray(value)) return value.map((child) => serializeJSONValue(child, inputs));
  if (value && typeof value === 'object') {
    if ('toJSON' in value && typeof value.toJSON === 'function') {
      return value.toJSON(null, inputs);
    }
    const result: Record<string, unknown> = {};
    for (const [name, child] of Object.entries(value)) {
      result[name] = serializeJSONValue(child, inputs);
    }
    return result;
  }
  return value;
}
