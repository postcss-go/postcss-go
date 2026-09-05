import { createRequire } from 'node:module';
import { call } from './bridge';

type PostCSSNode = {
  type: string;
  raws?: Record<string, unknown>;
  raw?: (key?: string) => unknown;
  parent?: unknown;
  source?: {
    start?: object;
    end?: object;
    input?: {
      file?: string;
      css?: string;
      hasBOM?: boolean;
      map?: { text?: string; mapFile?: string };
    };
  };
  selector?: unknown;
  name?: unknown;
  params?: unknown;
  prop?: unknown;
  value?: unknown;
  important?: unknown;
  text?: unknown;
  nodes?: PostCSSNode[];
};

type AstDto = Record<string, unknown> & {
  type: string;
  raws: Record<string, unknown>;
  nodes?: AstDto[];
};

type Builder = (css: string, node?: PostCSSNode, type?: string) => void;

type DtoContext = { nextId: number };

function shallowDtoOf(
  node: PostCSSNode,
  includeInput: boolean,
  materializeRaw: boolean | 'afterOnly',
  context: DtoContext,
): AstDto {
  const dto: AstDto = { type: node.type, raws: { ...(node.raws || {}) } };
  if (node.type === 'root' && node.source?.input?.hasBOM) {
    dto.raws.bom = true;
  }
  if (!node.source && node.type === 'decl' && dto.raws.between === ': ') {
    delete dto.raws.between;
  }
  if (
    !node.source &&
    node.type === 'rule' &&
    node.parent &&
    (node.parent as PostCSSNode).type === 'atrule' &&
    typeof dto.raws.before === 'string' &&
    dto.raws.before.trim() === ''
  ) {
    delete dto.raws.before;
  }
  if (
    !node.source &&
    node.type === 'rule' &&
    node.selector === 'from' &&
    (node.parent as PostCSSNode | undefined)?.type === 'atrule' &&
    (node.parent as PostCSSNode).name === 'keyframes'
  ) {
    dto.raws.before = '\n';
    dto.raws.between = '';
  }
  context.nextId += 1;
  // Direct node.toString() calls do not serialize the parent. Materialize
  // PostCSS's formatting samples while the parent is still available.
  if (materializeRaw && node.raw && node.parent) {
    const materializeSpacing = materializeRaw !== 'afterOnly';
    if (materializeRaw === 'afterOnly') {
      const rawKeys = Object.keys(node.raws || {});
      if (
        rawKeys.length <= 1 &&
        (!node.nodes || node.nodes.length === 0) &&
        !('after' in dto.raws) &&
        node.parent &&
        Array.isArray((node.parent as PostCSSNode).nodes)
      ) {
        const sample = (node.parent as PostCSSNode).nodes?.find((sibling) => {
          if (sibling === node || sibling.type !== node.type) return false;
          const value = sibling.raws?.after ?? sibling.raw?.('after');
          return typeof value === 'string' && value !== '' && value !== '\n' && /^\s+$/.test(value);
        });
        if (sample) dto.raws.after = sample.raws?.after ?? sample.raw?.('after');
      }
      if (node.source && node.type === 'atrule' && !('between' in dto.raws)) {
        const between = node.raw('between');
        if (typeof between === 'string' && between !== ' ') dto.raws.between = between;
      }
      if (node.type === 'atrule' && node.name === 'keyframes' && !('between' in dto.raws)) {
        dto.raws.between = '';
      }
      const after = node.raw('after');
      if (
        !('after' in dto.raws) &&
        node.type !== 'root' &&
        node.type !== 'document' &&
        after !== undefined &&
        (node.nodes?.length || after !== '\n')
      ) {
        dto.raws.after = after;
      }
    }
    const keys = ['before', 'between'];
    if (!materializeSpacing) {
      keys.length = 0;
    } else if (node.nodes && node.nodes.length > 0) {
      keys.push('after');
    } else {
      // PostCSS returns the default newline for `raw('after')` even when an
      // empty rule should stringify as `{}`. Preserve only a non-default
      // inherited sample such as `\n  ` or an explicit empty string.
      const after = node.raw('after');
      if (after !== undefined && after !== '\n') dto.raws.after = after;
    }
    for (const key of keys) {
      if (!(key in dto.raws)) {
        const value = node.raw(key);
        if (value === undefined) continue;
        if (key === 'before' && (value === '' || value === '\n')) continue;
        if (key === 'between' && value === defaultBetween(node)) continue;
        dto.raws[key] = value;
      }
    }
  }
  if (node.source) {
    const input = node.source.input;
    dto.source = {
      start: { ...node.source.start },
      end: { ...node.source.end },
      file: input?.file || '',
      ...(includeInput
        ? {
            css: input?.css || '',
            map: input?.map?.text || '',
            mapUrl: input?.map?.mapFile || input?.file || '',
          }
        : {}),
    };
  }
  switch (node.type) {
    case 'document':
    case 'root':
      break;
    case 'rule':
      dto.selector = String(node.selector ?? '');
      break;
    case 'atrule':
      dto.name = String(node.name ?? '');
      dto.params = String(node.params ?? '');
      dto.block = Boolean(node.nodes);
      break;
    case 'decl':
      dto.prop = String(node.prop ?? '');
      dto.value = String(node.value ?? '');
      dto.important = Boolean(node.important);
      break;
    case 'comment':
      dto.text = String(node.text ?? '');
      break;
    default:
      throw new Error(`Unsupported PostCSS AST node type: ${node.type}`);
  }
  return dto;
}

function flatDtoOf(
  node: PostCSSNode,
  includeInput = false,
  materializeRaw: boolean | 'afterOnly' = true,
  context: DtoContext = { nextId: 0 },
): Array<{ childCount: number; node: AstDto }> {
  const result: Array<{ childCount: number; node: AstDto }> = [];
  const stack: Array<{
    includeInput: boolean;
    materializeRaw: boolean | 'afterOnly';
    node: PostCSSNode;
  }> = [{ includeInput, materializeRaw, node }];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const children = current.node.nodes ?? [];
    result.push({
      childCount: children.length,
      node: shallowDtoOf(current.node, current.includeInput, current.materializeRaw, context),
    });
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ includeInput: false, materializeRaw: 'afterOnly', node: children[index] });
    }
  }

  return result;
}

function defaultBetween(node: PostCSSNode): string | undefined {
  if (node.type === 'decl') return ': ';
  if (node.type === 'rule' || node.type === 'atrule') return ' ';
  return undefined;
}

function flattenNodes(node: PostCSSNode): PostCSSNode[] {
  const result: PostCSSNode[] = [];
  const stack: PostCSSNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    result.push(current);
    if (!current.nodes) continue;
    for (let index = current.nodes.length - 1; index >= 0; index -= 1) {
      stack.push(current.nodes[index]);
    }
  }
  return result;
}

function approxDepth(node: PostCSSNode, limit = 2500): number {
  // Cheap chain-depth probe for the deeply-nested `a{a{...}}` cases that
  // overflow JSON.stringify when shipping the AST over the Go bridge.
  let depth = 0;
  let current: PostCSSNode | undefined = node;
  while (current && depth <= limit) {
    depth += 1;
    current = current.nodes?.[0];
  }
  return depth;
}

function stringifyWithUpstream(node: PostCSSNode, builder?: Builder): string | void {
  // Sibling PostCSS lib modules exist only after prepare-upstream-compat copies
  // these overrides into vendor/postcss/lib (or a temp test copy).
  const nodeRequire = createRequire(__filename);
  const Stringifier = nodeRequire('./stringifier.js');
  if (builder) {
    new Stringifier(builder).stringify(node);
    return;
  }
  let css = '';
  new Stringifier((piece: string) => {
    css += piece;
  }).stringify(node);
  return css;
}

function stringify(node: PostCSSNode, builder?: Builder): string | void {
  // Deep trees blow the stack inside JSON.stringify when encoding the AST for
  // the Go bridge; fall back to the vendored JS stringifier in that case.
  if (approxDepth(node) > 2000) {
    return stringifyWithUpstream(node, builder);
  }

  const result = call('stringify', {
    flatAst: flatDtoOf(node, true),
    builder: Boolean(builder),
  }) as {
    css: string;
    parts?: Array<{ css: string; node: number; type?: string }>;
  };
  const hasBOM = Boolean(node.source?.input?.hasBOM);
  if (builder) {
    const nodes = flattenNodes(node);
    if (!result.parts) {
      throw new Error('Go stringifier did not return builder parts');
    }
    if (hasBOM) {
      builder('\uFEFF', node, 'start');
    }
    for (const part of result.parts) {
      builder(part.css, part.node ? nodes[part.node - 1] : undefined, part.type);
    }
    return;
  }
  if (hasBOM && !result.css.startsWith('\uFEFF')) {
    return `\uFEFF${result.css}`;
  }
  return result.css;
}

stringify.default = stringify;

export = stringify;
