import postcss from 'postcss';
import PostcssStringifier from 'postcss/lib/stringifier';
import type { Raws } from './types.js';

export interface StringifiableNode {
  type: string;
  raws: Raws;
  parent?: {
    first?: StringifiableNode;
    last?: StringifiableNode;
    raws: Raws;
  };
  nodes?: StringifiableNode[];
  selector?: string;
  name?: string;
  params?: string;
  block?: boolean;
  prop?: string;
  value?: string;
  important?: boolean;
  text?: string;
}

// This small synchronous fallback exists only for PostCSS's Node#toString()
// contract. Pipeline and plugin-result stringification are Go-owned.
export function defaultRaw(
  node: StringifiableNode,
  prop: string,
  defaultType?: string,
): boolean | string {
  const stringifier = new PostcssStringifier(() => {});
  return stringifier.raw(
    node as unknown as Parameters<typeof stringifier.raw>[0],
    prop,
    defaultType,
  );
}

export function stringifyNode(node: StringifiableNode): string {
  let result = '';
  postcss.stringify(node as never, (chunk) => {
    result += chunk;
  });
  return result;
}
