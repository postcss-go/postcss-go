import path from 'node:path';
import postcss from 'postcss';
import { expect, test, vi } from 'vitest';
import { isExternalSourceMap, isSourceMapEnabled } from '@postcss-go/shared/map-options';

import { fromAst, Root, type Declaration, type Rule } from '../src/ast.ts';
import {
  assertGoCompatibility,
  createGoEngine,
  getEffectiveMapOption,
  processWithGoEngine,
  runPluginChain,
  type GoEngine,
} from '../src/engine.ts';
import type { AcceptedPlugin } from '../src/plugin-types.ts';

vi.mock('../src/native.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/native.ts')>();
  const parse = async (css: string) => ({ root: postcss.parse(css).toJSON() });
  const stringify = async (ast: Parameters<typeof fromAst>[0]) => fromAst(ast).toString();
  const stringifyResult = async (
    ast: Parameters<typeof fromAst>[0],
    options?: { map?: unknown },
  ) => ({
    css: await stringify(ast),
    ...(options?.map
      ? {
          map: JSON.stringify({
            version: 3,
            sources: ['input.css'],
            names: [],
            mappings: 'AAAA',
          }),
        }
      : {}),
  });
  return {
    ...actual,
    createDefaultAsyncService: vi.fn(() => ({
      process: vi.fn(),
      noWork: vi.fn(),
      parse: vi.fn(parse),
      stringify: vi.fn(stringify),
      stringifyResult: vi.fn(stringifyResult),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

function mockEngine(service: {
  process: ReturnType<typeof vi.fn>;
  noWork?: ReturnType<typeof vi.fn>;
  parse?: ReturnType<typeof vi.fn>;
  stringify?: ReturnType<typeof vi.fn>;
  stringifyResult?: ReturnType<typeof vi.fn>;
}): GoEngine {
  const engineService: GoEngine['service'] = {
    process: service.process,
    noWork: service.noWork ?? service.process,
    parse: service.parse ?? vi.fn(async (css: string) => ({ root: postcss.parse(css).toJSON() })),
    stringify:
      service.stringify ??
      vi.fn(async (ast: Parameters<typeof fromAst>[0]) => fromAst(ast).toString()),
    stringifyResult:
      service.stringifyResult ??
      vi.fn(async (ast: Parameters<typeof fromAst>[0], options?: { map?: unknown }) => ({
        css: fromAst(ast).toString(),
        ...(options?.map
          ? {
              map: JSON.stringify({
                version: 3,
                sources: ['input.css'],
                names: [],
                mappings: 'AAAA',
              }),
            }
          : {}),
      })),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    name: 'go',
    queue: Promise.resolve(),
    service: engineService,
    async close() {
      await engineService.close();
    },
  };
}

test('createGoEngine always returns the Go engine', async () => {
  const engine = createGoEngine();

  expect(engine.name).toBe('go');
  await engine.close();
});

test('processWithGoEngine converts buffer input and warning objects', async () => {
  const processSpy = vi.fn().mockResolvedValue({
    css: '.a { color: red; }',
    messages: [{ type: 'warning', text: 'be careful' }],
  });

  const result = await processWithGoEngine(
    mockEngine({ process: processSpy }),
    {},
    Buffer.from('.a { color: red; }'),
    {
      from: 'buffer.css',
    },
  );

  expect(processSpy).toHaveBeenCalledWith('.a { color: red; }', {
    from: 'buffer.css',
  });
  expect(result.map).toBeUndefined();
  expect(result.messages).toEqual([{ type: 'warning', text: 'be careful' }]);
  expect(result.warnings()[0]?.toString?.()).toBe('be careful');
});

test('processWithGoEngine finalizes plugins via stringifyResult without a second process', async () => {
  const processSpy = vi.fn();
  const stringifyResult = vi.fn(async (ast: Parameters<typeof fromAst>[0]) => ({
    css: fromAst(ast).toString(),
  }));
  const plugin = {
    postcssPlugin: 'to-blue',
    Declaration(decl) {
      decl.value = 'blue';
    },
  } satisfies AcceptedPlugin;

  const result = await processWithGoEngine(
    mockEngine({ process: processSpy, stringifyResult }),
    { plugins: [plugin] },
    '.a { color: red; }',
    { from: 'a.css', map: false },
  );

  expect(stringifyResult).toHaveBeenCalled();
  expect(processSpy).not.toHaveBeenCalled();
  expect(result.css).toContain('blue');
});

test('processWithGoEngine uses noWork when there are no plugins', async () => {
  const processSpy = vi.fn();
  const noWorkSpy = vi.fn().mockResolvedValue({ css: '.a {}' });

  await processWithGoEngine(
    mockEngine({ process: processSpy, noWork: noWorkSpy }),
    { plugins: [] },
    '.a {}',
    { from: 'a.css', map: false },
  );

  expect(noWorkSpy).toHaveBeenCalledWith('.a {}', { from: 'a.css', map: false });
  expect(processSpy).not.toHaveBeenCalled();
});

test('runPluginChain preserves async lifecycle and plugin messages', async () => {
  const plugin = {
    postcssPlugin: 'async-lifecycle',
    prepare(result) {
      result.messages.push({ type: 'dependency', file: 'tokens.css' });
      return {
        Once: async (root: Root) => {
          ((root.first as Rule).first as Declaration).value = 'blue';
        },
        DeclarationExit(decl: Declaration) {
          decl.warn(result, 'checked declaration');
        },
      };
    },
  } satisfies AcceptedPlugin;

  const result = await runPluginChain({ plugins: [plugin] }, '.a { color: red; }', {
    from: 'input.css',
    map: false,
  });

  expect(result.css).toContain('color: blue');
  expect(result.messages).toEqual(
    expect.arrayContaining([
      { type: 'dependency', file: 'tokens.css' },
      expect.objectContaining({ type: 'warning', text: 'checked declaration' }),
    ]),
  );
});

test('processWithGoEngine returns plugin source maps from stringifyResult', async () => {
  const processSpy = vi.fn();
  const stringifyResult = vi.fn(
    async (ast: Parameters<typeof fromAst>[0], options?: { map?: unknown }) => ({
      css: `${fromAst(ast).toString()}\n/*# sourceMappingURL=a.css.map */`,
      ...(options?.map
        ? {
            map: JSON.stringify({
              version: 3,
              sources: ['a.css'],
              names: [],
              mappings: 'AAAA',
            }),
            mapFile: '/dist/a.css.map',
          }
        : {}),
    }),
  );
  const plugin = {
    postcssPlugin: 'to-blue',
    Declaration(decl) {
      decl.value = 'blue';
    },
  } satisfies AcceptedPlugin;

  const result = await processWithGoEngine(
    mockEngine({ process: processSpy, stringifyResult }),
    { plugins: [plugin] },
    '.a { color: red; }',
    { from: '/src/a.css', to: '/dist/a.css', map: { inline: false } },
  );

  expect(processSpy).not.toHaveBeenCalled();
  expect(stringifyResult).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ map: { inline: false } }),
  );
  expect(result.css).toContain('blue');
  expect(result.map?.toString()).toContain('"version":3');
  expect(result.mapFile).toBe('/dist/a.css.map');
});

test('processWithGoEngine keeps inline maps when annotation is false', async () => {
  const processSpy = vi.fn().mockResolvedValue({
    css: '.a {}\n/*# sourceMappingURL=data:application/json;base64,e30= */',
    map: '',
    messages: [],
  });

  const result = await processWithGoEngine(
    mockEngine({ process: processSpy }),
    { plugins: [] },
    '.a {}',
    { from: 'a.css', map: { inline: true, annotation: false } },
  );

  expect(processSpy).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      map: { inline: true, annotation: false },
    }),
  );
  expect(processSpy.mock.calls[0][1].mapFile).toBeUndefined();
  expect(result.css).toContain('sourceMappingURL=data:application/json;base64,');
  expect(result.map).toBeUndefined();
});

test('processWithGoEngine computes auto-external output path after Go returns a map', async () => {
  const noWorkSpy = vi.fn().mockResolvedValue({
    css: '.a {}\n/*# sourceMappingURL=input.css.map */',
    map: '{"version":3,"sources":[],"names":[],"mappings":"AAAA"}',
    mapFile: 'input.css.map',
  });

  const result = await processWithGoEngine(
    mockEngine({ process: vi.fn(), noWork: noWorkSpy }),
    { plugins: [] },
    '.a {}\n/*# sourceMappingURL=previous.css.map */',
    { from: 'input.css' },
  );

  expect(noWorkSpy.mock.calls[0][1]).toEqual({
    from: 'input.css',
  });
  expect(result.mapFile).toBe('input.css.map');
});

test('processWithGoEngine defers default map mode to the Go noWork path', async () => {
  const processSpy = vi.fn().mockResolvedValue({
    css: '.a {}\n/*# sourceMappingURL=data:application/json;base64,e30= */',
    messages: [],
  });

  const result = await processWithGoEngine(
    mockEngine({ process: processSpy }),
    { plugins: [] },
    '.a {}\n/*# sourceMappingURL=previous.css.map */',
    { from: '/src/a.css', to: '/dist/a.css', map: {} },
  );

  expect(processSpy).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      map: {},
    }),
  );
  expect(result.mapFile).toBeUndefined();
});

test('processWithGoEngine resolves dynamic source map annotations before the Go bridge', async () => {
  const root = { type: 'root', nodes: [{ type: 'rule', selector: '.a', nodes: [] }] };
  const processSpy = vi.fn().mockResolvedValue({
    css: '.a {}\n/*# sourceMappingURL=maps/custom.map */',
    map: '{"version":3,"sources":[],"names":[],"mappings":"AAAA"}',
    mapFile: '/dist/maps/custom.map',
    messages: [],
  });
  const parseSpy = vi.fn().mockResolvedValue({ root });
  const annotation = vi.fn(async (_to, receivedRoot) => {
    expect(receivedRoot).toBeInstanceOf(Root);
    expect(receivedRoot).not.toBe(root);
    return 'maps/custom.map';
  });

  const result = await processWithGoEngine(
    mockEngine({ process: processSpy, parse: parseSpy }),
    { plugins: [] },
    '.a {}',
    {
      from: '/src/a.css',
      to: '/dist/a.css',
      map: { inline: false, annotation },
    },
  );

  expect(parseSpy).toHaveBeenCalledWith('.a {}', { from: '/src/a.css' });
  expect(annotation).toHaveBeenCalledWith('/dist/a.css', expect.any(Root));
  const expectedMapFile = path.resolve('/dist/maps/custom.map');
  expect(processSpy).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      map: { inline: false, annotation: 'maps/custom.map' },
    }),
  );
  expect(result.css).toContain('sourceMappingURL=maps/custom.map');
  expect(result.mapFile).toBe(expectedMapFile);
});

test('processWithGoEngine requires parse for annotation callbacks', async () => {
  await expect(
    processWithGoEngine(
      {
        name: 'go',
        queue: Promise.resolve(),
        service: {
          process: vi.fn(),
          noWork: vi.fn(),
          parse: undefined as never,
          stringify: vi.fn(),
          stringifyResult: vi.fn(),
          close: vi.fn(),
        },
        async close() {},
      },
      { plugins: [] },
      '.a {}',
      {
        from: '/src/a.css',
        to: '/dist/a.css',
        map: { inline: false, annotation: () => 'x.map' },
      },
    ),
  ).rejects.toThrow(/parse\(\) is required/);
});

test('processWithGoEngine preserves existing annotations when annotation is false', async () => {
  const processSpy = vi.fn().mockResolvedValue({
    css: '.a {}/*# sourceMappingURL=old.css.map */',
    map: '{"version":3,"sources":[],"names":[],"mappings":"AAAA"}',
    messages: [],
  });

  const result = await processWithGoEngine(
    mockEngine({ process: processSpy }),
    { plugins: [] },
    '.a {}/*# sourceMappingURL=old.css.map */',
    {
      from: '/src/a.css',
      to: '/dist/a.css',
      map: { inline: false, annotation: false },
    },
  );

  expect(processSpy).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      map: { inline: false, annotation: false },
    }),
  );
  expect(result.css).toContain('sourceMappingURL=old.css.map');
});

test('assertGoCompatibility identifies custom parser flags', () => {
  expect(assertGoCompatibility({ parser: './parser.js' }, { plugins: {}, options: {} })).toBe(
    false,
  );
});

test('assertGoCompatibility identifies custom config parser options', () => {
  expect(
    assertGoCompatibility(
      {},
      { plugins: { autoprefixer: {} }, options: { parser: './parser.js' } },
    ),
  ).toBe(false);
});

test('assertGoCompatibility rejects explicit PostCSS default syntax delegates', () => {
  expect(
    assertGoCompatibility(
      {},
      {
        options: {
          parser: postcss.parse,
          syntax: { parse: postcss.parse, stringify: postcss.stringify },
          stringifier: postcss.stringify,
        },
      },
    ),
  ).toBe(false);
});

test('assertGoCompatibility still rejects a genuinely custom syntax', () => {
  expect(
    assertGoCompatibility(
      {},
      { options: { syntax: { parse: postcss.parse, stringify: () => '' } } },
    ),
  ).toBe(false);
});

test('isExternalSourceMap detects external map configurations', () => {
  expect(isExternalSourceMap(false)).toBe(false);
  expect(isExternalSourceMap({})).toBe(false);
  expect(isExternalSourceMap({ annotation: true })).toBe(false);
  expect(isExternalSourceMap({ annotation: false })).toBe(true);
  expect(isExternalSourceMap({ inline: true })).toBe(false);
  expect(isExternalSourceMap(true)).toBe(false);
  expect(isExternalSourceMap({ inline: false })).toBe(true);
});

test('isSourceMapEnabled treats only false and undefined as disabled', () => {
  expect(isSourceMapEnabled(false)).toBe(false);
  expect(isSourceMapEnabled(undefined)).toBe(false);
  expect(isSourceMapEnabled(true)).toBe(true);
  expect(isSourceMapEnabled({ inline: true })).toBe(true);
  expect(isSourceMapEnabled({ inline: false })).toBe(true);
});

test('getEffectiveMapOption prefers config.options.map', () => {
  expect(getEffectiveMapOption({ options: { map: false }, map: true })).toBe(false);
  expect(getEffectiveMapOption({ map: { inline: true } })).toEqual({ inline: true });
});

test('Go compatibility allows enabled map options', () => {
  expect(() =>
    assertGoCompatibility({}, { options: { map: { inline: true } }, plugins: [] }),
  ).not.toThrow();
});

test('processWithGoEngine serializes requests', async () => {
  let active = 0;
  let maxActive = 0;

  const engine = mockEngine({
    process: vi.fn(async (css) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { css, messages: [] };
    }),
  });

  const results = await Promise.all([
    processWithGoEngine(engine, {}, '.a { color: red; }', { from: 'a.css' }),
    processWithGoEngine(engine, {}, '.b { color: blue; }', { from: 'b.css' }),
    processWithGoEngine(engine, {}, '.c { color: green; }', { from: 'c.css' }),
  ]);

  expect(maxActive).toBe(1);
  expect(results.map((result) => result.css)).toEqual([
    '.a { color: red; }',
    '.b { color: blue; }',
    '.c { color: green; }',
  ]);
});
