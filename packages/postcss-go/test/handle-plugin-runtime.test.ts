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
  expect(isHandleDeclarationPluginRun([colorPlugin])).toBe(true);
  expect(isHandleDeclarationPluginRun([colorPlugin, displayPlugin])).toBe(true);
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
