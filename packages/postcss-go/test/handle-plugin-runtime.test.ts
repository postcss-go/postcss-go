import { expect, test, vi } from 'vitest';

import { Processor } from '../src/processor.ts';
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
    if (decl.prop === 'display' && !decl.value.startsWith('prefixed-'))
      decl.value = `prefixed-${decl.value}`;
  },
};

test.skipIf(!isNativeBridgeAvailable())(
  'handle results preserve original sources without hydrating a TypeScript AST',
  async () => {
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

test.skipIf(!isNativeBridgeAvailable())(
  'native handle bridge runs declaration-only plugins end-to-end',
  async () => {
    const service = createNativeService();
    expect(service.handleBridge).not.toBeNull();
    expect(hasNativeHandleBridge(service.handleBridge)).toBe(true);

    const css = '.a { color: red; display: block; } .b { color: green; }';
    const viaRuntime = await runPluginsWithBridge(service, [colorPlugin, displayPlugin], css, {
      from: 'input.css',
      map: false,
    });

    expect(viaRuntime.css).toContain('color: navy');
    expect(viaRuntime.css).toContain('display: prefixed-block');
    expect(viaRuntime.root.first?.first).toMatchObject({ prop: 'color', value: 'navy' });
    await service.close();
  },
);

test.skipIf(!isNativeBridgeAvailable())(
  'sync plugin bridge uses the handle facade for read-only declaration plugins',
  () => {
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
      const removed = runPluginsWithBridgeSync(service, [plugin], 'a{x:y}', {});
      expect(calls).toBe(1);
      expect(removed.css).toBe('a{}');
      calls = 0;
      const mapped = runPluginsWithBridgeSync(service, [plugin], 'a{x:y}', {
        from: 'map.css',
        map: { inline: false, annotation: false },
      });
      expect(calls).toBe(1);
      expect(mapped.map).toBeTruthy();
      expect((mapped as { nativePlan?: { hydration: boolean } }).nativePlan?.hydration).toBe(false);
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
  'handle path runs structural helpers and source maps; parse errors surface from the session',
  () => {
    const service = createNativeService();
    const cloneAfter: AcceptedPlugin = {
      postcssPlugin: 'clone-border',
      Declaration(decl) {
        if (decl.prop === 'color') {
          decl.cloneAfter({ prop: 'border-color', value: 'black' });
        }
      },
    };

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
      handleBridge: new Proxy(service.handleBridge!, {
        get(target, key, receiver) {
          if (key === 'handleParse')
            return () => {
              throw new Error('boom');
            };
          return Reflect.get(target, key, receiver);
        },
      }),
    };
    expect(() =>
      runPluginsWithBridgeSync(exploding, [colorPlugin], 'a { color: red; }', {}),
    ).toThrow(/boom/);
    service.close();
  },
);
