import upstream from 'postcss';
import { expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CssSyntaxError, Input, PreviousMap, Warning, postcss } from '../src/index.ts';
import { hydrateInput } from '../src/input.ts';

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
  const actual = exercise(postcss.parse(css) as unknown as RootLike);
  expect(actual.visited).toEqual(expected.visited);
  expect(actual.css.replace(/\s+/g, ' ')).toBe(expected.css.replace(/\s+/g, ' '));
});

test('owned proxies keep identity and expose mutations during traversal', () => {
  const root = postcss.parse('.a { color: red }');
  const rule = root.first!;
  const proxy = rule.toProxy();
  expect(proxy.proxyOf).toBe(rule);
  proxy.assign({ selector: '.b' });
  expect(root.toString()).toContain('.b');
});

test('warnings and syntax errors preserve source, input, plugin, node, and location metadata', () => {
  const root = postcss.parse('.a {\n  color: red\n}', { from: 'input.css' });
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
    input: {
      line: 2,
      column: 3,
      source: '.a {\n  color: red\n}',
    },
  });
});

test('Input constructor, offsets, ranges, and inline previous maps match the public contract', () => {
  const sourceMap = Buffer.from(
    JSON.stringify({
      version: 3,
      sources: ['a.scss'],
      names: [],
      mappings: 'AAAA',
      sourcesContent: ['a{}'],
    }),
  ).toString('base64');
  const css = `\uFEFFa{}\n/*# sourceMappingURL=data:application/json;base64,${sourceMap} */`;
  const input = new Input(css, { from: 'a.css' });

  expect(input.css.startsWith('\uFEFF')).toBe(false);
  expect(input.hasBOM).toBe(true);
  expect(input.document).toBe(input.css);
  expect(input.file).toMatch(/a\.css$/);
  expect(input.fromLineAndColumn(2, 1)).toBe(4);
  expect(input.fromOffset(4)).toEqual({ line: 2, col: 1 });
  expect(input.fromOffset(-1)).toBeNull();
  expect(input.map).toBeInstanceOf(PreviousMap);
  expect(typeof input.map?.consumer).toBe('function');
  expect(input.mapResolve('https://example.com/a.css')).toBe('https://example.com/a.css');
  expect(input.mapResolve('orig.css')).toContain('orig.css');

  const plain = new Input('ab\nc', { from: 'plain.css' });
  expect(plain.error('broken', 2)).toMatchObject({ line: 1, column: 3 });
  expect(() => plain.error('bad', -1)).toThrow(/Invalid CSS offset/);

  const error = input.error(
    'broken',
    { line: 1, column: 1 },
    { line: 1, column: 3 },
    {
      plugin: 'contract',
    },
  );
  expect(error.input).toMatchObject({
    line: 1,
    column: 1,
    endLine: 1,
    endColumn: 3,
  });
  expect(error.message).toContain('contract:');
  expect(error.toString()).toContain('CssSyntaxError:');

  const json = input.toJSON();
  expect(json.map).toBeTruthy();
  expect((json.map as { consumerCache?: unknown }).consumerCache).toBeUndefined();

  const hydrated = hydrateInput({
    css: '.a{}',
    file: 'x.css',
    map: { text: Buffer.from(sourceMap, 'base64').toString('utf8'), inline: true },
  }) as Input;
  expect(hydrated).toBeInstanceOf(Input);
  expect(hydrated.map).toBeInstanceOf(PreviousMap);
});

test('Warning string formatting follows node error formatting', () => {
  const root = postcss.parse('a{color:red}', { from: 'a.css' });
  const warning = new Warning('check', {
    plugin: 'contract',
    node: root.first!.first!,
  });
  expect(warning.toString()).toMatch(/^contract: .*a\.css:1:3: check$/);
});

test('Input loads an external previous source map through the Node entry point', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'postcss-go-input-'));
  try {
    const from = path.join(directory, 'input.css');
    writeFileSync(
      `${from}.map`,
      JSON.stringify({
        version: 3,
        sources: ['input.scss'],
        names: [],
        mappings: 'AAAA',
        sourcesContent: ['a{}'],
      }),
    );

    const input = new Input('a{}\n/*# sourceMappingURL=input.css.map */', { from });
    expect(input.map?.mapFile).toBe(`${from}.map`.replace(/\\/g, '/'));
    expect(input.map?.consumer().sources).toEqual(['input.scss']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Input resolves URL source roots and file:// original sources', () => {
  const withRoot = Buffer.from(
    JSON.stringify({
      version: 3,
      sourceRoot: 'https://example.com/css',
      sources: ['a.scss'],
      names: [],
      mappings: 'AAAA',
      sourcesContent: ['a{}'],
    }),
  ).toString('base64');
  const rooted = new Input(
    `a{}\n/*# sourceMappingURL=data:application/json;base64,${withRoot} */`,
    { from: 'a.css' },
  );
  expect(rooted.mapResolve('b.css')).toBe('https://example.com/css/b.css');

  const withFile = Buffer.from(
    JSON.stringify({
      version: 3,
      sources: ['file:///tmp/orig.scss'],
      names: [],
      mappings: 'AAAA',
      sourcesContent: ['a{}'],
    }),
  ).toString('base64');
  const filed = new Input(`a{}\n/*# sourceMappingURL=data:application/json;base64,${withFile} */`, {
    from: 'a.css',
  });
  const origin = filed.origin(1, 1, 1, 2);
  expect(origin).toMatchObject({
    file: '/tmp/orig.scss',
    url: 'file:///tmp/orig.scss',
    endLine: expect.any(Number),
  });
  expect(filed.error('broken', { line: 1, column: 1 }, { line: 1, column: 2 }).file).toBe(
    '/tmp/orig.scss',
  );
});
