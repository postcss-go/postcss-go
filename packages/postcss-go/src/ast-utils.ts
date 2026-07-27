import type { AstNode, RawField, Raws, SourceLocation } from './types.js';

export const INTERNAL_NODE_PROPERTIES = new Set([
  'clean',
  'indexes',
  'lastEach',
  'parentNode',
  'proxyCache',
  'rawsProvided',
]);

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
    const input = inputs[source.inputId] as { file?: unknown; from?: unknown } | undefined;
    const { inputId: _inputId, input: _input, ...position } = source;
    node.source = {
      ...position,
      ...(input?.from || input?.file ? { file: String(input.from ?? input.file) } : {}),
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

export function splitList(value: string, separator: string): string[] {
  const result: string[] = [];
  let current = '';
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (const char of value) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === '(') {
      depth++;
      current += char;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
      current += char;
    } else if (char === separator && depth === 0) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current !== '' || value.endsWith(separator)) result.push(current.trim());
  return result;
}
