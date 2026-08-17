/**
 * PostCSS `Node#raw()` default inference. CSS stringify is Go-owned
 * (`Node#toString()`, pipeline stringify, and builder callbacks).
 */
import type { Raws } from './types.js';

export interface StringifiableNode {
  type: string;
  raws: Raws;
  parent?: StringifiableNode & {
    first?: StringifiableNode;
    last?: StringifiableNode;
  };
  nodes?: StringifiableNode[];
  first?: StringifiableNode;
  last?: StringifiableNode;
  selector?: string;
  name?: string;
  params?: string;
  prop?: string;
  value?: string;
  important?: boolean;
  text?: string;
}

const DEFAULT_RAW: Record<string, string | boolean> = {
  after: '\n',
  beforeClose: '\n',
  beforeComment: '\n',
  beforeDecl: '\n',
  beforeOpen: ' ',
  beforeRule: '\n',
  colon: ': ',
  commentLeft: ' ',
  commentRight: ' ',
  emptyBody: '',
  indent: '    ',
  semicolon: false,
};

function rootOf(node: StringifiableNode): StringifiableNode {
  let current = node;
  while (current.parent && current.parent.type !== 'document') current = current.parent;
  return current;
}

function walk(
  node: StringifiableNode,
  callback: (node: StringifiableNode) => boolean | void,
): boolean {
  for (const child of node.nodes ?? []) {
    if (callback(child) === false) return false;
    if (walk(child, callback) === false) return false;
  }
  return true;
}

function detectRaw(node: StringifiableNode, own: string | null, detect: string): string | boolean {
  if (own && node.raws[own] !== undefined) return node.raws[own] as string | boolean;
  const parent = node.parent;
  if (detect === 'before') {
    if (
      !parent ||
      (parent.type === 'root' && parent.first === node) ||
      parent.type === 'document'
    ) {
      return '';
    }
    return beforeAfter(node, 'before');
  }
  if (detect === 'after') return beforeAfter(node, 'after');

  const root = rootOf(node);
  let found: string | boolean | undefined;
  if (detect === 'beforeOpen') {
    walk(root, (candidate) => {
      if (candidate.type !== 'decl' && candidate.raws.between !== undefined) {
        found = candidate.raws.between as string | boolean;
        return false;
      }
    });
  } else if (detect === 'colon') {
    walk(root, (candidate) => {
      if (candidate.type === 'decl' && typeof candidate.raws.between === 'string') {
        found = candidate.raws.between.replace(/[^\s:]/g, '');
        return false;
      }
    });
  } else if (detect === 'semicolon') {
    walk(root, (candidate) => {
      if (
        candidate.nodes?.length &&
        candidate.last?.type === 'decl' &&
        candidate.raws.semicolon !== undefined
      ) {
        found = candidate.raws.semicolon as boolean;
        return false;
      }
    });
  } else if (detect === 'emptyBody') {
    walk(root, (candidate) => {
      if (candidate.nodes?.length === 0 && candidate.raws.after !== undefined) {
        found = candidate.raws.after as string;
        return false;
      }
    });
  } else if (detect === 'indent') {
    if (typeof root.raws.indent === 'string') found = root.raws.indent;
    else {
      walk(root, (candidate) => {
        const parentNode = candidate.parent;
        if (
          parentNode &&
          parentNode !== root &&
          parentNode.parent &&
          parentNode.parent === root &&
          typeof candidate.raws.before === 'string'
        ) {
          const parts = candidate.raws.before.split('\n');
          found = parts[parts.length - 1].replace(/\S/g, '');
          return false;
        }
      });
    }
  } else if (detect === 'beforeClose') {
    walk(root, (candidate) => {
      if (candidate.nodes?.length && typeof candidate.raws.after === 'string') {
        found = candidate.raws.after.includes('\n')
          ? candidate.raws.after.replace(/[^\n]+$/, '').replace(/\S/g, '')
          : candidate.raws.after.replace(/\S/g, '');
        return false;
      }
    });
  } else if (detect === 'beforeDecl') {
    walk(root, (candidate) => {
      if (candidate.type === 'decl' && typeof candidate.raws.before === 'string') {
        found = candidate.raws.before.includes('\n')
          ? candidate.raws.before.replace(/[^\n]+$/, '').replace(/\S/g, '')
          : candidate.raws.before.replace(/\S/g, '');
        return false;
      }
    });
    if (found === undefined) return detectRaw(node, null, 'beforeRule');
  } else if (detect === 'beforeComment') {
    walk(root, (candidate) => {
      if (candidate.type === 'comment' && typeof candidate.raws.before === 'string') {
        found = candidate.raws.before.includes('\n')
          ? candidate.raws.before.replace(/[^\n]+$/, '').replace(/\S/g, '')
          : candidate.raws.before.replace(/\S/g, '');
        return false;
      }
    });
    if (found === undefined) return detectRaw(node, null, 'beforeDecl');
  } else if (detect === 'beforeRule') {
    walk(root, (candidate) => {
      if (
        candidate.nodes &&
        (candidate.parent !== root || root.first !== candidate) &&
        typeof candidate.raws.before === 'string'
      ) {
        found = candidate.raws.before.includes('\n')
          ? candidate.raws.before.replace(/[^\n]+$/, '').replace(/\S/g, '')
          : candidate.raws.before.replace(/\S/g, '');
        return false;
      }
    });
  } else if (own) {
    walk(root, (candidate) => {
      if (candidate.raws[own] !== undefined) {
        found = candidate.raws[own] as string | boolean;
        return false;
      }
    });
  }
  return found ?? DEFAULT_RAW[detect] ?? '';
}

function beforeAfter(node: StringifiableNode, detect: string): string {
  let value =
    node.type === 'decl'
      ? String(detectRaw(node, null, 'beforeDecl'))
      : node.type === 'comment'
        ? String(detectRaw(node, null, 'beforeComment'))
        : detect === 'before'
          ? String(detectRaw(node, null, 'beforeRule'))
          : String(detectRaw(node, null, 'beforeClose'));

  let depth = 0;
  let buf = node.parent;
  while (buf && buf.type !== 'root') {
    depth += 1;
    buf = buf.parent;
  }

  if (value.includes('\n')) {
    const indent = String(detectRaw(node, null, 'indent'));
    if (indent.length) {
      for (let step = 0; step < depth; step++) value += indent;
    }
  }
  return value;
}

export function defaultRaw(
  node: StringifiableNode,
  prop: string,
  defaultType?: string,
): boolean | string {
  return detectRaw(node, prop, defaultType ?? prop);
}
