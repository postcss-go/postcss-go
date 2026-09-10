import { HANDLE_REQUIRED_CAPABILITIES } from '../src/generated/handle-protocol.ts';
import { afterEach, expect, test, vi } from 'vitest';

import { Processor } from '../src/processor.ts';
import {
  isHandleDeclarationPluginRun,
  runHandleDeclarationPlugins,
} from '../src/handle-plugin-runtime.ts';
import { hasNativeHandleBridge } from '../src/handle-session.ts';
import { createNativeService, isNativeBridgeAvailable } from '../src/native.ts';
import { runPluginsWithBridge, runPluginsWithBridgeSync } from '../src/plugin-runtime.ts';
import type { AcceptedPlugin } from '../src/plugin-types.ts';

afterEach(() => vi.unstubAllEnvs());

test.skipIf(!isNativeBridgeAvailable())(
  'handle results preserve original sources without hydrating a TypeScript AST',
  async () => {
    vi.stubEnv('POSTCSS_GO_NATIVE_AST', 'handle');
    const service = createNativeService();
    const parse = vi.spyOn(service, 'parseSync');
    const css = 'a{color:red;\nheight:1px}';
    const plugin: AcceptedPlugin = {
      postcssPlugin: 'expanded-value',
      Declaration(decl) {
        if (decl.prop === 'color') {
          expect(decl.value).toBe('red');
        }
      },
    };
    try {
      const result = await runPluginsWithBridge(service, [plugin], css, {
        from: 'source.css',
        map: false,
      });
      expect(parse).not.toHaveBeenCalled();
      const firstRoot = result.root;
      expect(firstRoot).toBe(result.root);
      expect(parse).not.toHaveBeenCalled();
      const rule = firstRoot.first!;
      expect(rule.nodes).toHaveLength(2);
      expect(rule.first).toMatchObject({ prop: 'color', value: 'red' });
      expect(rule.last).toMatchObject({
        prop: 'height',
        source: { start: { line: 2, column: 1, offset: css.indexOf('height') } },
      });
      expect(rule.first!.source!.input).toBe(rule.last!.source!.input);
      expect(rule.last!.source!.input.css).toBe(css);
      expect(firstRoot.toString()).toBe(result.css);
    } finally {
      service.close();
    }
  },
);

const colorPlugin: AcceptedPlugin = {
  postcssPlugin: 'color-to-navy',
  Declaration(decl) {
    if (decl.prop === 'color') decl.value = 'navy';
  },
};

const displayPlugin: AcceptedPlugin = {
  postcssPlugin: 'display-prefix',
  Declaration(decl) {
    if (decl.prop === 'display' && !decl.value.startsWith('prefixed-'))
      decl.value = `prefixed-${decl.value}`;
  },
};

test('isHandleDeclarationPluginRun accepts declaration-only plugins', () => {
  expect(isHandleDeclarationPluginRun([])).toBe(false);
  expect(isHandleDeclarationPluginRun([colorPlugin])).toBe(true);
  expect(isHandleDeclarationPluginRun([colorPlugin, displayPlugin])).toBe(true);
  expect(isHandleDeclarationPluginRun([((root) => root) as AcceptedPlugin])).toBe(false);
  expect(
    isHandleDeclarationPluginRun([
      {
        postcssPlugin: 'rule-plugin',
        Rule(rule) {
          rule.selector = `${rule.selector}:hover`;
        },
      },
    ]),
  ).toBe(false);
  expect(
    isHandleDeclarationPluginRun([
      {
        postcssPlugin: 'async-decl',
        async Declaration(decl) {
          decl.value = 'navy';
        },
      },
    ]),
  ).toBe(false);
  expect(
    isHandleDeclarationPluginRun([
      {
        postcssPlugin: 'with-exit',
        Declaration(decl) {
          decl.value = 'navy';
        },
        DeclarationExit() {},
      },
    ]),
  ).toBe(false);
  expect(
    isHandleDeclarationPluginRun([
      {
        postcssPlugin: 'with-prepare',
        prepare() {
          return {};
        },
        Declaration(decl) {
          decl.value = 'navy';
        },
      },
    ]),
  ).toBe(false);
});

test.skipIf(!isNativeBridgeAvailable())(
  'native handle bridge runs declaration-only plugins end-to-end',
  async () => {
    const service = createNativeService();
    expect(service.handleAddon).not.toBeNull();
    expect(hasNativeHandleBridge(service.handleAddon)).toBe(true);

    const css = '.a { color: red; display: block; } .b { color: green; }';
    const viaRuntime = await runPluginsWithBridge(service, [colorPlugin, displayPlugin], css, {
      from: 'input.css',
      map: false,
    });
    const viaHandle = runHandleDeclarationPlugins(service.handleAddon!, css, [
      colorPlugin,
      displayPlugin,
    ]);

    expect(viaRuntime.css).toBe(viaHandle);
    expect(viaRuntime.css).toContain('color: navy');
    expect(viaRuntime.css).toContain('display: prefixed-block');
    expect(viaRuntime.root.first?.first).toMatchObject({ prop: 'color', value: 'navy' });
    await service.close();
  },
);

test.skipIf(!isNativeBridgeAvailable())(
  'sync plugin bridge uses the handle facade for read-only declaration plugins',
  () => {
    vi.stubEnv('POSTCSS_GO_NATIVE_AST', 'handle');
    const service = createNativeService();
    const css = '.card { color: black; }';
    const result = runPluginsWithBridgeSync(
      service,
      [
        {
          postcssPlugin: 'read',
          Declaration(decl) {
            expect(decl.value).toBe('black');
          },
        },
      ],
      css,
      {
        from: 'input.css',
        map: false,
      },
    );
    expect(result.css).toBe(css);
  },
);

test('Processor uses the handle path for declaration-only native plugins', async () => {
  if (!isNativeBridgeAvailable()) return;
  const css = 'button { color: rgb(0, 0, 0); }';
  const result = await new Processor([colorPlugin]).process(css, { from: 'btn.css', map: false });
  expect(result.css).toContain('color: navy');
  expect(result.backend).toBe('native');
});

test.skipIf(!isNativeBridgeAvailable())(
  'planner never replays callbacks after unsupported access',
  async () => {
    const service = createNativeService();
    let calls = 0;
    const plugin: AcceptedPlugin = {
      postcssPlugin: 'side-effect',
      Declaration(decl) {
        calls++;
        decl.remove();
      },
    };
    try {
      await runPluginsWithBridge(service, [plugin], 'a{x:y}', {});
      expect(calls).toBe(1);
      calls = 0;
      vi.stubEnv('POSTCSS_GO_NATIVE_AST', 'handle');
      expect(() => runPluginsWithBridgeSync(service, [plugin], 'a{x:y}', {})).toThrow(/support/);
      expect(calls).toBe(1);
      calls = 0;
      expect(() => runPluginsWithBridgeSync(service, [plugin], 'a{x:y}', { map: true })).toThrow(
        /source maps/,
      );
      expect(calls).toBe(0);
      vi.stubEnv('POSTCSS_GO_NATIVE_AST', 'invalid');
      expect(() => runPluginsWithBridgeSync(service, [plugin], '', {})).toThrow(/mode/);
    } finally {
      service.close();
    }
  },
);

test.skipIf(!isNativeBridgeAvailable())(
  'restricted handle runtime permits nested independent sessions and node-major order',
  () => {
    const service = createNativeService();
    const seen: string[] = [];
    const plugins: AcceptedPlugin[] = [
      {
        postcssPlugin: 'first',
        Declaration(decl) {
          seen.push(`first:${decl.prop}`);
          expect(
            runHandleDeclarationPlugins(service.handleAddon!, 'b{color:red}', [colorPlugin]),
          ).toBe('b{color:navy}');
        },
      },
      {
        postcssPlugin: 'second',
        Declaration(decl) {
          seen.push(`second:${decl.prop}`);
        },
      },
    ];
    try {
      expect(runHandleDeclarationPlugins(service.handleAddon!, 'a{x:y;z:w}', plugins)).toBe(
        'a{x:y;z:w}',
      );
      expect(seen).toEqual(['first:x', 'second:x', 'first:z', 'second:z']);
    } finally {
      service.close();
    }
  },
);

test('Processor falls back from the handle path for structural declaration mutations', async () => {
  if (!isNativeBridgeAvailable()) return;
  const plugin: AcceptedPlugin = {
    postcssPlugin: 'clone-border',
    Declaration(decl) {
      if (decl.prop === 'color') {
        decl.cloneAfter({ prop: 'border-color', value: 'black' });
      }
    },
  };
  const result = await new Processor([plugin]).process('a { color: red; }', {
    from: 'clone.css',
    map: false,
  });
  expect(result.css).toContain('border-color: black');
});

test('Processor falls back from the handle path for async declaration visitors', async () => {
  if (!isNativeBridgeAvailable()) return;
  const plugin: AcceptedPlugin = {
    postcssPlugin: 'async-to-navy',
    async Declaration(decl) {
      await Promise.resolve();
      if (decl.prop === 'color') decl.value = 'navy';
    },
  };
  const result = await new Processor([plugin]).process('.x { color: red }', {
    from: 'async.css',
    map: false,
  });
  expect(result.css).toContain('navy');
});

test.skipIf(!isNativeBridgeAvailable())(
  'handle declaration runtime covers empty trees, prop writes, and skipped visitors',
  () => {
    const service = createNativeService();
    const addon = service.handleAddon!;
    expect(runHandleDeclarationPlugins(addon, '/* comment only */', [colorPlugin])).toContain(
      'comment only',
    );

    const rename: AcceptedPlugin = {
      postcssPlugin: 'rename-color',
      Declaration(decl) {
        if (decl.prop === 'color') decl.prop = 'background-color';
      },
    };
    const transformer = ((root) => root) as AcceptedPlugin;
    const asyncVisitor: AcceptedPlugin = {
      postcssPlugin: 'skip-async',
      async Declaration(decl) {
        decl.value = 'ignored';
      },
    };
    const css = runHandleDeclarationPlugins(addon, 'a { color: red; }', [
      transformer,
      asyncVisitor,
      rename,
    ]);
    expect(css).toContain('background-color');
    service.close();
  },
);

test.skipIf(!isNativeBridgeAvailable())(
  'handle path falls back for thenable visitors, helpers, and source maps',
  () => {
    const service = createNativeService();
    const thenable: AcceptedPlugin = {
      postcssPlugin: 'thenable-decl',
      Declaration(decl) {
        decl.value = 'navy';
        return Promise.resolve();
      },
    };
    const helpers: AcceptedPlugin = {
      postcssPlugin: 'helpers-decl',
      Declaration(_decl, pluginHelpers: { result?: unknown }) {
        return pluginHelpers.result;
      },
    };
    const cloneAfter: AcceptedPlugin = {
      postcssPlugin: 'clone-border',
      Declaration(decl) {
        if (decl.prop === 'color') {
          decl.cloneAfter({ prop: 'border-color', value: 'black' });
        }
      },
    };

    expect(() =>
      runHandleDeclarationPlugins(service.handleAddon!, 'a { color: red; }', [thenable]),
    ).toThrow(/async/);
    expect(() =>
      runHandleDeclarationPlugins(service.handleAddon!, 'a { color: red; }', [helpers]),
    ).toThrow(/helpers/);
    expect(
      runPluginsWithBridgeSync(service, [cloneAfter], 'a { color: red; }', { map: false }).css,
    ).toContain('border-color: black');
    expect(
      runPluginsWithBridgeSync(service, [colorPlugin], 'a { color: red; }', { map: true }).css,
    ).toContain('navy');

    const exploding = {
      capabilities: service.capabilities,
      parseSync: service.parseSync.bind(service),
      stringifyResultSync: service.stringifyResultSync.bind(service),
      handleAddon: {
        handleProtocolInfo: () => ({
          major: 2,
          minor: 0,
          maxBatchSize: 4096,
          capabilities: new Uint32Array([HANDLE_REQUIRED_CAPABILITIES[0] | 16]),
        }),
        handleParseV2() {
          throw new Error('boom');
        },
        handleCloseV2() {},
        handleTypeV2: () => 0,
        handleGetFieldV2: () => '',
        handleSetFieldV2() {},
        handleWalkDeclsV2: () => 0,
        handleOpenCursorV2: () => 0,
        handleCursorNextV2: () => 0,
        handleCloseCursorV2() {},
        handleReadFieldsV2: () => [],
        handleReadSnapshotsV2: () => '[]',
        handleSetFieldsV2() {},
        handleStringifyV2: () => '',
        handleNewDeclV2: () => 1,
        handleAppendV2() {},
        handleDisposeV2() {},
      },
    };
    vi.stubEnv('POSTCSS_GO_NATIVE_AST', 'handle');
    expect(() =>
      runPluginsWithBridgeSync(exploding, [colorPlugin], 'a { color: red; }', {}),
    ).toThrow(/boom/);
    service.close();
  },
);
