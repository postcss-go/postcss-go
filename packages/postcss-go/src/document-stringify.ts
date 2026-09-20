import type { Node } from './ast.js';

/**
 * Document is the public identity skeleton and is not interned. Join Go-owned
 * children the way Go writes a document node: inferred `\n` before siblings
 * that do not carry their own `raws.before`.
 */
export function stringifyDocumentChildren(
  document: Node,
  stringifyChild: (child: Node) => string,
): string {
  const nodes = ((document as { nodes?: Node[] }).nodes ?? []) as Node[];
  return nodes
    .map((child, index) => {
      const css = stringifyChild(child);
      const ownBefore = typeof child.raws?.before === 'string' ? child.raws.before : undefined;
      const before = ownBefore ?? (index === 0 ? '' : '\n');
      return `${before}${css}`;
    })
    .join('');
}
