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
  expect(result.messages).toEqual([]);
  expect(result.warnings()[0].toString()).toBe('be careful');
});

test('assertGoEngineCompatible rejects custom parser flags and object-style plugins', () => {
  expect(() =>
    assertGoEngineCompatible({ engine: 'go', parser: './parser.js' }, { plugins: {}, options: {} }),
  ).toThrow(
    'Engine Error: postcss-go does not support custom parser/syntax/stringifier yet; use --engine postcss',
  );

  expect(() =>
    assertGoEngineCompatible({ engine: 'go' }, { plugins: { autoprefixer: {} }, options: {} }),
  ).toThrow(
    'Engine Error: postcss-go does not support postcss.config.js plugins yet; use --engine postcss',
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
