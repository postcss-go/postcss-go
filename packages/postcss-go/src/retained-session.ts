/**
 * Go-owned trees for the public parse APIs.
 *
 * A plugin run may close its session when the run ends, but `postcss.parse()`
 * hands the tree to the caller with no scope to close. Reachability therefore
 * decides the arena lifetime: the returned wrapper is registered here, and the
 * session closes once the whole wrapper graph becomes unreachable.
 */
import { Node, type ProcessRoot } from './ast.js';
import { ownerOf, SessionOwner, type SessionOwnerOptions } from './handle-facade.js';
import type { HandleBridge } from './handle-session.js';

/**
 * Only the bridge and the arena id may be held. Capturing the owner or the
 * session would keep the tree reachable and the finalizer would never run.
 */
type ArenaRef = { bridge: HandleBridge; sessionId: number };

const arenas = new FinalizationRegistry<ArenaRef>(({ bridge, sessionId }) => {
  try {
    bridge.handleClose(sessionId);
  } catch {
    // A torn-down bridge has already released every arena it owned.
  }
});

let defaultBridge: HandleBridge | null = null;

/** Point constructors and fromJSON at the process-wide handle transport. */
export function setDefaultHandleBridge(bridge: HandleBridge | null): void {
  defaultBridge = bridge;
}

export function getDefaultHandleBridge(): HandleBridge | null {
  return defaultBridge;
}

function retain(root: Node, owner: SessionOwner): void {
  const sessionId = owner.session.sessionId;
  if (sessionId === undefined) return;
  arenas.register(root, { bridge: owner.session.handleBridge, sessionId }, root);
}

/** Register a plugin or interned tree so GC closes the arena. */
export function retainOwned(root: Node, owner: SessionOwner): void {
  retain(root, owner);
}

/** Parse into a Go arena whose lifetime follows the returned tree. */
export function parseRetained(
  bridge: HandleBridge,
  css: string,
  options: SessionOwnerOptions = {},
): ProcessRoot {
  const owner = new SessionOwner(bridge, css, { ...options, mutableStructure: true });
  const root = owner.root;
  retain(root, owner);
  return root;
}

/** True when the node belongs to a Go arena rather than a detached TS tree. */
export function isGoOwned(node: unknown): boolean {
  return node instanceof Node && ownerOf(node) !== undefined;
}

/**
 * Release a retained tree early. Idempotent, and safe to call on a tree that
 * was never retained; reads after this point fail as use-after-close.
 */
export function releaseRetained(root: Node): void {
  const owner = ownerOf(root);
  if (!owner) return;
  arenas.unregister(root);
  owner.close();
}

const GO_OWNED_TYPES = new Set(['root', 'rule', 'atrule', 'decl', 'comment']);

/**
 * Intern a freshly constructed or JSON-hydrated node into a retained Go arena.
 * No-ops when no default bridge is installed (tests without the native addon).
 * Documents and custom node types stay on the TypeScript identity skeleton.
 */
export function internDetached<T extends Node>(node: T): T {
  if (ownerOf(node)) return node;
  if (!GO_OWNED_TYPES.has(node.type)) return node;
  const bridge = defaultBridge;
  if (!bridge) return node;
  const source = node.source as
    | { css?: string; file?: string; input?: { css?: string; from?: string; file?: string } }
    | undefined;
  // Never reparse source.input.css: that would mint a stylesheet and then intern()
  // would append the JSON children on top of it. Input metadata stays on the node.
  const from = source?.input?.file || source?.input?.from;
  const owner = new SessionOwner(bridge, '', { from, mutableStructure: true });
  try {
    const interned = owner.intern(node) as T;
    retain(interned, owner);
    return interned;
  } catch (error) {
    owner.close();
    if (error instanceof Error && /document intern|create /.test(error.message)) return node;
    throw error;
  }
}
