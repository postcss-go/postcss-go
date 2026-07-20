import path from 'node:path';
import postcss from 'postcss';
import { expect, test, vi } from 'vitest';

vi.mock('../src/node.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/node.ts')>();
  return {
    ...actual,
    createNodeService: vi.fn(() => ({
      process: vi.fn(),
      parse: vi.fn(),
      stringify: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

import {
  assertGoCompatibility,
  createGoEngine,
  getEffectiveMapOption,
  isExternalSourceMap,
  isSourceMapEnabled,
  processWithGoEngine,
  runPluginChain,
} from '../src/engine.ts';

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

  const engine = {
    name: 'go',
    queue: Promise.resolve(),
    service: {
      process: processSpy,
    },
  };

  const result = await processWithGoEngine(engine, {}, Buffer.from('.a { color: red; }'), {
    from: 'buffer.css',
  });

  expect(processSpy).toHaveBeenCalledWith('.a { color: red; }', { from: 'buffer.css' });
  expect(result.map).toBeUndefined();
  expect(result.messages).toEqual([{ type: 'warning', text: 'be careful' }]);
  expect(result.warnings()[0].toString()).toBe('be careful');
});

test('processWithGoEngine runs plugins before the Go bridge', async () => {
  const processSpy = vi.fn().mockImplementation(async (css) => ({
    css,
    messages: [],
  }));
  const plugin = {
    postcssPlugin: 'to-blue',
    Declaration(decl: postcss.Declaration) {
      decl.value = 'blue';
    },
  };

  const result = await processWithGoEngine(
    {
      name: 'go',
      queue: Promise.resolve(),
      service: {
        process: processSpy,
      },
    },
    { plugins: [plugin] },
    '.a { color: red; }',
    { from: 'a.css', map: false },
  );

  expect(processSpy).toHaveBeenCalledWith(expect.stringContaining('blue'), { from: 'a.css' });
  expect(result.css).toContain('blue');
});

test('runPluginChain preserves async lifecycle and plugin messages', async () => {
  const plugin = {
    postcssPlugin: 'async-lifecycle',
    prepare(result) {
      result.messages.push({ type: 'dependency', file: 'tokens.css' });
      return {
        Once: async (root) => {
          root.first.first.value = 'blue';
        },
        DeclarationExit(decl) {
          decl.warn(result, 'checked declaration');
        },
      };
    },
  };

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

test('processWithGoEngine passes the plugin map to the Go bridge for composition', async () => {
  const processSpy = vi.fn().mockImplementation(async (css) => ({
    css,
    map: '{"version":3,"sources":[],"names":[],"mappings":""}',
    messages: [],
  }));
  const plugin = {
    postcssPlugin: 'to-blue',
    Declaration(decl: postcss.Declaration) {
      decl.value = 'blue';
    },
  };

  await processWithGoEngine(
    {
      name: 'go',
      queue: Promise.resolve(),
      service: { process: processSpy },
    },
    { plugins: [plugin] },
    '.a { color: red; }',
    { from: '/src/a.css', to: '/dist/a.css', map: { inline: false } },
  );

  expect(processSpy).toHaveBeenCalledWith(
    expect.stringContaining('blue'),
    expect.objectContaining({
      map: true,
      mapFile: '/dist/a.css.map',
      previousMap: expect.stringContaining('"version":3'),
      previousMapUrl: '/dist/a.css.map',
    }),
  );
});

test('processWithGoEngine keeps inline maps when annotation is false', async () => {
  const processSpy = vi.fn().mockResolvedValue({
    css: '.a {}',
    map: '{"version":3,"sources":[],"names":[],"mappings":""}',
    messages: [],
  });

  const result = await processWithGoEngine(
    {
      name: 'go',
      queue: Promise.resolve(),
      service: { process: processSpy },
    },
    { plugins: [] },
    '.a {}',
    { from: 'a.css', map: { inline: true, annotation: false } },
  );

  expect(result.css).toContain('sourceMappingURL=data:application/json;base64,');
  expect(result.map).toBeUndefined();
});

test('processWithGoEngine resolves dynamic source map annotations before the Go bridge', async () => {
  const processSpy = vi.fn().mockResolvedValue({
    css: '.a {}',
    map: '{"version":3,"sources":[],"names":[],"mappings":"AAAA"}',
    messages: [],
  });
  const annotation = vi.fn((_to, root) => {
    expect(root.type).toBe('root');
    return 'maps/custom.map';
  });

  const result = await processWithGoEngine(
    {
      name: 'go',
      queue: Promise.resolve(),
      service: { process: processSpy },
    },
    { plugins: [] },
    '.a {}',
    {
      from: '/src/a.css',
      to: '/dist/a.css',
      map: { inline: false, annotation },
    },
  );

  expect(annotation).toHaveBeenCalledWith('/dist/a.css', expect.anything());
  const expectedMapFile = path.resolve('/dist/maps/custom.map');
  expect(processSpy).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ mapFile: expectedMapFile }),
  );
  expect(result.css).toContain('sourceMappingURL=maps/custom.map');
  expect(result.mapFile).toBe(expectedMapFile);
});

test('processWithGoEngine preserves existing annotations when annotation is false', async () => {
  const processSpy = vi.fn().mockResolvedValue({
    css: '.a {}/*# sourceMappingURL=old.css.map */',
    map: '{"version":3,"sources":[],"names":[],"mappings":"AAAA"}',
    messages: [],
  });

  const result = await processWithGoEngine(
    {
      name: 'go',
      queue: Promise.resolve(),
      service: { process: processSpy },
    },
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
    expect.objectContaining({ preserveAnnotation: true }),
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

test('isExternalSourceMap detects external map configurations', () => {
  expect(isExternalSourceMap(false)).toBe(false);
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

  const engine = {
    name: 'go',
    queue: Promise.resolve(),
    service: {
      async process(css) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return { css, messages: [] };
      },
    },
  };

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
