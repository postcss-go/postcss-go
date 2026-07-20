import path from 'node:path';
import postcss from 'postcss';
import { afterEach, expect, test, vi } from 'vitest';

import { assertGoCompatibility, createGoEngine, processWithGoEngine } from '../lib/engine.js';
import {
  getBundledGoBridgeBinPath,
  resolveGoBridgeServiceOptions,
} from '../lib/resolveGoBridge.js';

const originalArgv = [...process.argv];
const originalBin = process.env.POSTCSS_GO_NODE_API_BIN;

afterEach(() => {
  process.argv = [...originalArgv];
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

test('args normalizes --ext without exposing an engine option', async () => {
  const argv = await importArgs(['input.css', '--dir', 'out', '--ext', 'min.css']);

  expect(argv.ext).toBe('.min.css');
  expect(argv.dir).toBe('out');
  expect(argv.engine).toBeUndefined();
  expect(argv._).toEqual(['input.css']);
});

test('args has no engine default', async () => {
  const argv = await importArgs(['input.css', '--no-map']);

  expect(argv.engine).toBeUndefined();
  expect(argv.map).toBe(false);
});

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

test('assertGoCompatibility rejects custom parser flags', () => {
  expect(() =>
    assertGoCompatibility({ parser: './parser.js' }, { plugins: {}, options: {} }),
  ).toThrow('Engine Error: postcss-go does not support custom parser/syntax/stringifier yet');
});

test('assertGoCompatibility rejects custom config parser options', () => {
  expect(() =>
    assertGoCompatibility(
      {},
      { plugins: { autoprefixer: {} }, options: { parser: './parser.js' } },
    ),
  ).toThrow(
    'Engine Error: postcss-go does not support postcss.config.js parser/syntax/stringifier yet',
  );
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
