import upstream from 'postcss';
import { expect, test } from 'vitest';

import { CssSyntaxError, Input, Warning, postcssApi } from '../src/index.ts';

type RootLike = ReturnType<typeof upstream.parse>;

function exercise(root: RootLike): { css: string; visited: string[] } {
  const visited: string[] = [];
  root.prepend({ selector: '.first', nodes: [] });
  root.append({ selector: '.last', nodes: [] });
  const middle = root.nodes[1];
  root.insertBefore(middle, { type: 'comment', text: 'before' });
  root.insertAfter(middle, middle.clone({ selector: '.clone' }));
  root.walk((node) => visited.push(node.type));
  root.last?.remove();
  return { css: root.toString(), visited };
}

test('Node and Container mutation/traversal contract matches upstream PostCSS', () => {
  const css = '.a { color: red }';
  const expected = exercise(upstream.parse(css));
  const actual = exercise(postcssApi.parse(css) as unknown as RootLike);
  expect(actual.visited).toEqual(expected.visited);
  expect(actual.css.replace(/\s+/g, ' ')).toBe(expected.css.replace(/\s+/g, ' '));
});

test('owned proxies keep identity and expose mutations during traversal', () => {
  const root = postcssApi.parse('.a { color: red }');
  const rule = root.first!;
  const proxy = rule.toProxy();
  expect(proxy.proxyOf).toBe(rule);
  proxy.assign({ selector: '.b' });
  expect(root.toString()).toContain('.b');
});

test('warnings and syntax errors preserve source, input, plugin, node, and location metadata', () => {
  const root = postcssApi.parse('.a {\n  color: red\n}', { from: 'input.css' });
  const declaration = root.first!.first!;
  const result = { messages: [], lastPlugin: { postcssPlugin: 'contract' } };
  const warning = declaration.warn(result, 'check') as unknown as Warning;
  expect(warning).toMatchObject({
    plugin: 'contract',
    node: declaration,
    line: 2,
    column: 3,
    source: '.a {\n  color: red\n}',
  });
  expect(warning.input).toBeInstanceOf(Input);

  const error = declaration.error('broken', { plugin: 'contract' }) as CssSyntaxError;
  expect(error).toMatchObject({
    plugin: 'contract',
    postcssNode: declaration,
    line: 2,
    column: 3,
    source: '.a {\n  color: red\n}',
  });
  expect(error.input).toBeInstanceOf(Input);
});
