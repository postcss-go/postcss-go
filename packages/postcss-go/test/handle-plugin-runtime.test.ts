import { expect, test } from 'vitest';

import { Processor } from '../src/processor.ts';
import {
  isHandleDeclarationPluginRun,
  runHandleDeclarationPlugins,
} from '../src/handle-plugin-runtime.ts';
import { hasNativeHandleBridge } from '../src/handle-session.ts';
import { createNativeService, isNativeBridgeAvailable } from '../src/native.ts';
import { runPluginsWithBridge, runPluginsWithBridgeSync } from '../src/plugin-runtime.ts';
import type { AcceptedPlugin } from '../src/plugin-types.ts';

const colorPlugin: AcceptedPlugin = {
  postcssPlugin: 'color-to-navy',
  Declaration(decl) {
    if (decl.prop === 'color') decl.value = 'navy';
  },
};

const displayPlugin: AcceptedPlugin = {
  postcssPlugin: 'display-prefix',
  Declaration(decl) {
    if (decl.prop === 'display') decl.value = `prefixed-${decl.value}`;
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
  'sync plugin bridge uses the handle path for declaration-only plugins',
  () => {
    const service = createNativeService();
    const css = '.card { color: black; }';
    const result = runPluginsWithBridgeSync(service, [colorPlugin], css, {
      from: 'input.css',
      map: false,
    });
    expect(result.css).toContain('color: navy');
  },
);

test('Processor uses the handle path for declaration-only native plugins', async () => {
  if (!isNativeBridgeAvailable()) return;
  const css = 'button { color: rgb(0, 0, 0); }';
  const result = await new Processor([colorPlugin]).process(css, { from: 'btn.css', map: false });
  expect(result.css).toContain('color: navy');
  expect(result.backend).toBe('native');
});

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
        handleParse() {
          throw new Error('boom');
        },
        handleClose() {},
        handleType: () => 0,
        handleGetField: () => '',
        handleSetField() {},
        handleWalkDecls: () => 0,
        handleOpenCursor: () => 0,
        handleCursorNext: () => 0,
        handleCloseCursor() {},
        handleReadFields: () => [],
        handleSetFields() {},
        handleStringify: () => '',
        handleNewDecl: () => 1,
        handleAppend() {},
        handleDispose() {},
      },
    };
    expect(() =>
      runPluginsWithBridgeSync(exploding, [colorPlugin], 'a { color: red; }', {}),
    ).toThrow(/boom/);
    service.close();
  },
);
