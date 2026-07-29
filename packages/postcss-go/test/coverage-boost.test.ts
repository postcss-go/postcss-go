import { readFileSync } from 'node:fs';
import { SourceMapConsumer, SourceMapGenerator } from 'source-map-js';
import { afterEach, expect, test, vi } from 'vitest';

import {
  Input,
  PreviousMap,
  fromJSON,
  hydrateInput,
  list,
  postcss,
  setPreviousMapFileLoader,
  toResult,
} from '../src/index.ts';
import { parseOwnedSync } from '../src/parser.ts';

const originalArgv = [...process.argv];

afterEach(() => {
  process.argv = [...originalArgv];
  setPreviousMapFileLoader((file) => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
  });
});

test('args covers poll normalization and parse error paths', async () => {
  process.argv = ['node', 'postcss-go', 'input.css', '--poll'];
  vi.resetModules();
  await expect(import('../src/args.ts').then((m) => m.parseCliArgs())).rejects.toThrow(
    /poll requires watch/i,
  );

  process.argv = ['node', 'postcss-go', 'input.css', '--watch', '--poll'];
  vi.resetModules();
  await expect(import('../src/args.ts').then((m) => m.parseCliArgs())).resolves.toMatchObject({
    watch: true,
    poll: '100',
  });

  process.argv = ['node', 'postcss-go', 'input.css', '--not-a-real-flag'];
  vi.resetModules();
  await expect(import('../src/args.ts').then((m) => m.parseCliArgs())).rejects.toThrow(
    /Unknown argument: not-a-real-flag/,
  );
});

test('owned parser covers comments, at-rules, important, and quote boundaries', () => {
  const root = parseOwnedSync(
    '/* leading */\n@import "x.css";\n.a { color: red !important; content: "a:b"; background: url(a:b) }\n',
    { from: 'input.css' },
  );
  expect(root.toString()).toContain('leading');
  expect(root.toString()).toContain('@import');
  expect(root.toString()).toContain('!important');
  expect(root.toString()).toContain('"a:b"');

  expect(() => parseOwnedSync('/* unclosed')).toThrow(/Unclosed comment/);
  expect(() => parseOwnedSync('.a { color: "unterminated')).toThrow();
  expect(() => parseOwnedSync('}')).toThrow(/Unexpected }/);

  const withEmpty = parseOwnedSync('.a { ; color: blue }');
  expect(withEmpty.toString()).toContain('blue');

  const escaped = parseOwnedSync('.a { content: "\\""; prop: val\\:ue }');
  expect(escaped.toString()).toContain('content');
});

test('PreviousMap covers loaders, generators, and invalid map text', () => {
  const raw = {
    version: 3,
    sources: ['a.css'],
    names: [],
    mappings: 'AAAA',
    sourcesContent: ['.a{}'],
  };
  const consumer = new SourceMapConsumer(raw);
  const generator = SourceMapGenerator.fromSourceMap(consumer);

  expect(
    new PreviousMap('.a{}', {
      from: 'a.css',
      map: { prev: generator },
    }).text,
  ).toContain('"version":3');

  expect(
    new PreviousMap('.a{}', {
      from: 'a.css',
      map: { prev: () => raw },
    }).text,
  ).toContain('"version":3');

  expect(
    new PreviousMap('.a{}', {
      from: 'a.css',
      map: {
        prev: {
          toString() {
            return JSON.stringify(raw);
          },
        },
      },
    }).text,
  ).toContain('"version":3');

  setPreviousMapFileLoader(() => `${JSON.stringify(raw)}\n`);
  const fromFile = new PreviousMap('.a{}\n/*# sourceMappingURL=out.css.map */', {
    from: '/tmp/a.css',
  });
  expect(fromFile.text).toContain('"version":3');
  expect(fromFile.mapFile).toMatch(/out\.css\.map$/);

  setPreviousMapFileLoader(() => 'not-json');
  expect(
    new PreviousMap('.a{}\n/*# sourceMappingURL=broken.css.map */', { from: '/tmp/a.css' }).text,
  ).toBeUndefined();

  const uriEncoded = encodeURIComponent(JSON.stringify(raw));
  const uriMap = new PreviousMap(
    `.a{}\n/*# sourceMappingURL=data:application/json,${uriEncoded} */`,
  );
  expect(uriMap.inline).toBe(true);
  expect(uriMap.toJSON()?.version).toBe(3);

  expect(() =>
    new PreviousMap('.a{}\n/*# sourceMappingURL=data:text/plain;base64,YQ== */'),
  ).toThrow(/Unsupported source map encoding/);

  const broken = new PreviousMap('.a{}', { map: { prev: '{not-json' } });
  expect(broken.toJSON()).toBeUndefined();
  expect(broken.withContent()).toBe(false);
  expect(broken.toString()).toBe('{not-json');

  const empty = new PreviousMap('.a{}', { map: false });
  expect(empty.toString()).toBe('');
  expect(() => empty.consumer()).toThrow(/not available/);
});

test('Input covers offset errors, mapResolve, hydrate, and JSON map projection', () => {
  const input = new Input('a\nb', { from: '/tmp/input.css' });
  const byOffset = input.error('broken', 2);
  expect(byOffset).toMatchObject({ line: 2, column: 1 });
  expect(() => input.error('bad', -1)).toThrow(/Invalid CSS offset/);
  expect(input.fromOffset(-1)).toBeNull();
  expect(input.mapResolve('https://example.com/a.css')).toBe('https://example.com/a.css');

  const text = JSON.stringify({
    version: 3,
    sources: ['orig.css'],
    names: [],
    mappings: 'AAAA',
    sourcesContent: ['.a{}'],
    sourceRoot: '/sources',
  });
  const css = `.a{}\n/*# sourceMappingURL=data:application/json;base64,${Buffer.from(text).toString('base64')} */`;
  const mapped = new Input(css, { from: '/tmp/built.css' });
  expect(mapped.map).toBeInstanceOf(PreviousMap);
  expect(mapped.mapResolve('orig.css')).toContain('orig.css');
  expect(mapped.toJSON().map).toBeTruthy();
  expect((mapped.toJSON().map as { consumerCache?: unknown }).consumerCache).toBeUndefined();

  const hydrated = hydrateInput({
    css: '.a{}',
    file: 'x.css',
    map: { text, inline: true },
  }) as Input;
  expect(hydrated).toBeInstanceOf(Input);
  expect(hydrated.map).toBeInstanceOf(PreviousMap);
});

test('list helpers cover escapes and quotes', () => {
  expect(list.comma('a\\,b, "c,d", fn(1,2)')).toEqual(['a\\,b', '"c,d"', 'fn(1,2)']);
  expect(list.space("a\\ b 'c d'")).toEqual(['a\\ b', "'c d'"]);
});

test('plugin runtime covers transformers, nested packs, and prepare errors', async () => {
  const transformed = await postcss([
    (root) => {
      root.walkDecls((decl) => {
        decl.value = 'blue';
      });
    },
  ]).process('.a{color:red}', { from: 'input.css' });
  expect(transformed.css).toContain('blue');

  const packed = await postcss([
    {
      plugins: [
        {
          postcssPlugin: 'nested',
          Declaration(decl) {
            decl.value = 'green';
          },
        },
      ],
    },
  ]).process('.a{color:red}', { from: 'input.css' });
  expect(packed.css).toContain('green');

  await expect(
    postcss([
      {
        postcssPlugin: 'bad-prepare',
        prepare() {
          throw Object.assign(new Error('boom'), { plugin: undefined });
        },
      },
    ]).process('.a{}', { from: 'input.css' }),
  ).rejects.toThrow(/boom/);

  await expect(
    postcss([
      {
        postcssPlugin: 'unknown-event',
        WeirdEvent() {},
      } as never,
    ]).process('.a{}', { from: 'input.css' }),
  ).rejects.toThrow(/Unknown event WeirdEvent/);
});

test('toResult creates a default service when none is provided', async () => {
  const root = postcss.parse('.a{color:red}', { from: 'input.css' });
  const result = await toResult(root);
  expect(result.css).toContain('color:red');
  expect(result.root).toBe(root);
});

test('AST helpers cover nested raw clones and constructor fallbacks', () => {
  const root = postcss.root({
    nodes: [
      postcss.rule({
        selector: '.a',
        raws: {
          before: ' ',
          between: ' ',
          nested: { left: '  ', items: [{ mark: '*' }] },
        } as never,
        nodes: [postcss.decl({ prop: 'color', value: 'red' })],
      }),
    ],
  });
  const clone = root.clone();
  expect((clone.first as { raws: { nested?: unknown } }).raws.nested).toEqual({
    left: '  ',
    items: [{ mark: '*' }],
  });

  expect(fromJSON({ nodes: [] }).type).toBe('root');
  expect(() => fromJSON({} as never)).toThrow(/Unsupported AST node type/);
});
