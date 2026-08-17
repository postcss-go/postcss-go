/**
 * Test-only CSS stringify. Production Node#toString() and pipeline stringify
 * go through Go; this helper exists for suites that mock the native addon.
 */
import { defaultRaw, type StringifiableNode } from '../../src/ast-stringifier.ts';

type ChunkBuilder = (chunk: string, node?: StringifiableNode, type?: string) => void;

function rawValue(node: StringifiableNode, property: keyof StringifiableNode): string {
  const value = String(node[property] ?? '');
  const raw = node.raws[property as string];
  if (
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    'raw' in raw &&
    raw.value === value
  ) {
    return String(raw.raw);
  }
  return value;
}

export function stringifyNode(node: StringifiableNode): string {
  let css = '';
  stringify(node, (chunk) => {
    css += chunk;
  });
  return css;
}

function stringify(node: StringifiableNode, builder: ChunkBuilder): void {
  const raw = (target: StringifiableNode, own: string | null, detect = own ?? '') =>
    defaultRaw(target, own ?? detect, detect);
  const body = (container: StringifiableNode): void => {
    const nodes = container.nodes ?? [];
    let lastNonComment = nodes.length - 1;
    while (lastNonComment > 0 && nodes[lastNonComment].type === 'comment') lastNonComment -= 1;
    const semicolon = Boolean(raw(container, 'semicolon'));
    for (let index = 0; index < nodes.length; index++) {
      const child = nodes[index];
      const before = String(raw(child, 'before'));
      if (before) builder(before);
      emit(child, index !== lastNonComment || semicolon);
    }
  };
  const block = (target: StringifiableNode, start: string): void => {
    builder(`${start}${String(raw(target, 'between', 'beforeOpen'))}{`, target, 'start');
    if (target.nodes?.length) {
      body(target);
      const after = String(raw(target, 'after'));
      if (after) builder(after);
    } else {
      const after = String(raw(target, 'after', 'emptyBody'));
      if (after) builder(after);
    }
    builder('}', target, 'end');
  };
  const emit = (target: StringifiableNode, semicolon = false): void => {
    switch (target.type) {
      case 'root':
      case 'document':
        body(target);
        if (target.type === 'root' && target.raws.after) builder(String(target.raws.after));
        break;
      case 'rule':
        block(target, rawValue(target, 'selector'));
        if (target.raws.ownSemicolon) builder(String(target.raws.ownSemicolon), target, 'end');
        break;
      case 'atrule': {
        const params = target.params ? rawValue(target, 'params') : '';
        const afterName =
          target.raws.afterName !== undefined ? String(target.raws.afterName) : params ? ' ' : '';
        const start = `@${target.name ?? ''}${afterName}${params}`;
        if (target.nodes) block(target, start);
        else builder(`${start}${String(target.raws.between ?? '')}${semicolon ? ';' : ''}`, target);
        break;
      }
      case 'decl': {
        let value = `${target.prop ?? ''}${String(raw(target, 'between', 'colon'))}${rawValue(target, 'value')}`;
        if (target.important) value += String(target.raws.important ?? ' !important');
        builder(`${value}${semicolon ? ';' : ''}`, target);
        break;
      }
      case 'comment':
        builder(
          `/*${String(raw(target, 'left', 'commentLeft'))}${target.text ?? ''}${String(raw(target, 'right', 'commentRight'))}*/`,
          target,
        );
        break;
      default:
        throw new Error(`Unknown AST node type ${target.type}. Provide a custom stringifier.`);
    }
  };
  emit(node);
}
