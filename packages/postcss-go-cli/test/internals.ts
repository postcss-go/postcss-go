import path from 'node:path';
import postcss from 'postcss';
import { afterEach, expect, test, vi } from 'vitest';

import { assertGoEngineCompatible, createEngine, processWithEngine } from '../lib/engine.js';
import {
  getBundledGoBridgeBinPath,
  resolveGoBridgeServiceOptions,
} from '../lib/resolveGoBridge.js';

const originalArgv = [...process.argv];
const originalEngine = process.env.POSTCSS_GO_ENGINE;
const originalBin = process.env.POSTCSS_GO_NODE_API_BIN;

afterEach(() => {
  process.argv = [...originalArgv];
  if (originalEngine === undefined) {
    delete process.env.POSTCSS_GO_ENGINE;
  } else {
    process.env.POSTCSS_GO_ENGINE = originalEngine;
  }

  if (originalBin === undefined) {
    delete process.env.POSTCSS_GO_NODE_API_BIN;
  } else {
    process.env.POSTCSS_GO_NODE_API_BIN = originalBin;
  }
});

async function importArgs(args: string[], env: Record<string, string | undefined> = {}) {
  process.argv = ['node', 'postcss-go', ...args];
  vi.resetModules();

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return (await import('../lib/args.js')).default;
}

test('args normalizes --ext and respects the POSTCSS_GO_ENGINE default', async () => {
  const argv = await importArgs(['input.css', '--dir', 'out', '--ext', 'min.css'], {
    POSTCSS_GO_ENGINE: 'go',
  });

  expect(argv.ext).toBe('.min.css');
  expect(argv.dir).toBe('out');
  expect(argv.engine).toBe('go');
  expect(argv._).toEqual(['input.css']);
});

test('args keeps the default postcss engine when POSTCSS_GO_ENGINE is unset', async () => {
  const argv = await importArgs(['input.css', '--no-map'], { POSTCSS_GO_ENGINE: undefined });

  expect(argv.engine).toBe('postcss');
  expect(argv.map).toBe(false);
});

test('createEngine returns a postcss engine with a no-op close', async () => {
  const engine = createEngine({ engine: 'postcss' });

  expect(engine.name).toBe('postcss');
  await expect(engine.close()).resolves.toBeUndefined();
});

test('processWithEngine runs the postcss branch with plugins', async () => {
  const plugin = {
    postcssPlugin: 'to-blue',
    Declaration(decl: postcss.Declaration) {
      decl.value = 'blue';
    },
  };

  const result = await processWithEngine(
    { name: 'postcss', close: async () => {} },
    { plugins: [plugin] },
    '.a { color: red; }',
    { from: 'a.css' },
  );

  expect(result.css).toContain('blue');
});

test('processWithEngine converts buffer input and warning objects for the go engine', async () => {
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

  const result = await processWithEngine(engine, {}, Buffer.from('.a { color: red; }'), {
    from: 'buffer.css',
  });

  expect(processSpy).toHaveBeenCalledWith('.a { color: red; }', { from: 'buffer.css' });
  expect(result.map).toBeUndefined();
  expect(result.messages).toEqual([{ type: 'warning', text: 'be careful' }]);
  expect(result.warnings()[0].toString()).toBe('be careful');
});

test('processWithEngine runs plugins before the go bridge', async () => {
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

  const result = await processWithEngine(
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

test('processWithEngine passes the plugin map to the go bridge for composition', async () => {
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

  await processWithEngine(
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

test('processWithEngine keeps inline maps when annotation is false', async () => {
  const processSpy = vi.fn().mockResolvedValue({
    css: '.a {}',
    map: '{"version":3,"sources":[],"names":[],"mappings":""}',
    messages: [],
  });

  const result = await processWithEngine(
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

test('processWithEngine resolves dynamic source map annotations before the Go bridge', async () => {
  const processSpy = vi.fn().mockResolvedValue({
    css: '.a {}',
    map: '{"version":3,"sources":[],"names":[],"mappings":"AAAA"}',
    messages: [],
  });
  const annotation = vi.fn((_to, root) => {
    expect(root.type).toBe('root');
    return 'maps/custom.map';
  });

  const result = await processWithEngine(
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

test('processWithEngine preserves existing annotations when annotation is false', async () => {
  const processSpy = vi.fn().mockResolvedValue({
    css: '.a {}/*# sourceMappingURL=old.css.map */',
    map: '{"version":3,"sources":[],"names":[],"mappings":"AAAA"}',
    messages: [],
  });

  const result = await processWithEngine(
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

test('assertGoEngineCompatible rejects custom parser flags', () => {
  expect(() =>
    assertGoEngineCompatible({ engine: 'go', parser: './parser.js' }, { plugins: {}, options: {} }),
  ).toThrow(
    'Engine Error: postcss-go does not support custom parser/syntax/stringifier yet; use --engine postcss',
  );
});

test('assertGoEngineCompatible is a no-op for the postcss engine', () => {
  expect(() =>
    assertGoEngineCompatible(
      { engine: 'postcss', parser: './parser.js', use: ['autoprefixer'] },
      { plugins: { autoprefixer: {} }, options: { map: true } },
    ),
  ).not.toThrow();
});

test('resolveGoBridgeServiceOptions prefers the POSTCSS_GO_NODE_API_BIN override', () => {
  process.env.POSTCSS_GO_NODE_API_BIN = '/tmp/custom-postcss-go-node-api';

  expect(resolveGoBridgeServiceOptions()).toEqual({
    binPath: '/tmp/custom-postcss-go-node-api',
  });
});

test('resolveGoBridgeServiceOptions falls back to the bundled test bridge when no env override exists', () => {
  delete process.env.POSTCSS_GO_NODE_API_BIN;

  expect(resolveGoBridgeServiceOptions()).toEqual({
    binPath: getBundledGoBridgeBinPath(),
  });
});
