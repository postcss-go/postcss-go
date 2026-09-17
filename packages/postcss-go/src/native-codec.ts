/**
 * Binary AST codec helpers for the hydrated/fallback native path.
 *
 * Soft-gated behind this module so the handle facade does not import codec
 * symbols directly. Hard removal waits on the two-release rollback window
 * (see docs/specs/go-owned-ast-handle-migration.md Phase 7).
 *
 * Callers must use these wrappers (not re-exported codec symbols) so the
 * package build keeps `./codec.js` as a dependency of this module only.
 */
import { Node, type Root } from './ast.js';
import { decodeAst, encodeAst, hydrateAst, serializeAst } from './codec.js';
import type { AstNode, ProcessResult, ResultMessage } from './types.js';

const PROCESS_FRAME_MAGIC = 'PCGP';
const PROCESS_FRAME_HEADER_SIZE = 8;

export function decodeRootAst(buffer: Buffer | Uint8Array): AstNode {
  return decodeAst(buffer);
}

export function encodeRootAst(root: AstNode): Buffer {
  return encodeAst(root);
}

export function hydrateRootAst(buffer: Buffer | Uint8Array): Root {
  return hydrateAst(buffer);
}

export function encodeBoundaryAst(ast: AstNode | Node): Buffer {
  return ast instanceof Node ? serializeAst(ast) : encodeAst(ast);
}

export function indexLiveNodes(node: Node): Node[] {
  const nodes: Node[] = [];
  const visit = (current: Node): void => {
    nodes.push(current);
    for (const child of (current as Node & { nodes?: Node[] }).nodes ?? []) visit(child);
  };
  visit(node);
  return nodes;
}

/** Encode the node's root so Go can infer raws from siblings, plus a 1-based index. */
export function encodeStringifyTarget(node: Node): { buffer: Buffer; options?: string } {
  const root = node.root();
  if (root === node) return { buffer: serializeAst(node) };
  const nodeIndex = indexLiveNodes(root).indexOf(node) + 1;
  return {
    buffer: serializeAst(root),
    options: nodeIndex > 0 ? JSON.stringify({ nodeIndex }) : undefined,
  };
}

export function decodeProcessFrame(frame: Buffer): ProcessResult {
  if (
    frame.length < PROCESS_FRAME_HEADER_SIZE ||
    frame.subarray(0, 4).toString('ascii') !== PROCESS_FRAME_MAGIC
  ) {
    throw new Error('postcss-go native process response has an invalid frame');
  }
  const metadataLength = frame.readUInt32LE(4);
  const rootOffset = PROCESS_FRAME_HEADER_SIZE + metadataLength;
  if (rootOffset > frame.length) {
    throw new Error('postcss-go native process response has invalid metadata length');
  }
  const metadata = JSON.parse(
    frame.subarray(PROCESS_FRAME_HEADER_SIZE, rootOffset).toString('utf8'),
  ) as {
    css: string;
    map?: string;
    mapFile?: string;
    messages?: ResultMessage[];
  };
  return {
    css: metadata.css,
    map: metadata.map,
    mapFile: metadata.mapFile,
    root: hydrateAst(frame.subarray(rootOffset)),
    messages: metadata.messages ?? [],
  };
}
