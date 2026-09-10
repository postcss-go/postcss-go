import { afterEach, expect, test, vi } from 'vitest';
import { AtRule, Comment, Container, Declaration, Document, Node, Root, Rule } from '../src/ast.ts';
import { SessionOwner } from '../src/handle-facade.ts';
import { planHandleExecution } from '../src/handle-plan.ts';
import {
  createNativeService,
  installNativeSyncCssRuntime,
  isNativeBridgeAvailable,
} from '../src/native.ts';
import {
  runPluginsWithBridge,
  runPluginsWithBridgeSync,
  type RuntimePlugin,
} from '../src/plugin-runtime.ts';
import type { AcceptedPlugin } from '../src/plugin-types.ts';
import type { NativeHandleAddon } from '../src/handle-session.ts';

if (isNativeBridgeAvailable()) installNativeSyncCssRuntime();
const native = test.skipIf(!isNativeBridgeAvailable());
afterEach(() => vi.unstubAllEnvs());

native.each([
  '',
  '/* hello */\n@charset "utf-8"; @media screen { a,b { color: red !important; --x: é } }',
  'a{};\n',
  '😀 {x:é}',
  '\uFEFFa{x:y}',
])('read-only handle/binary differential: %j', (css) => {
  const service = createNativeService();
  const execute = (mode: string) => {
    vi.stubEnv('POSTCSS_GO_NATIVE_AST', mode);
    const trace: unknown[] = [];
    const seen = new Map<Node, Node>();
    const inspect = (node: Node, event: string) => {
      const original = node.proxyOf;
      expect(node instanceof Node).toBe(true);
      expect(node.toProxy()).toBe(node.toProxy());
      expect(Object.getPrototypeOf(node).constructor).toBe(
        {
          root: Root,
          rule: Rule,
          atrule: AtRule,
          decl: Declaration,
          comment: Comment,
          document: Document,
        }[node.type],
      );
      if (node.parent)
        expect(node.parent.nodes.some((child) => child.proxyOf === original)).toBe(true);
      if (seen.has(original)) expect(seen.get(original)!.proxyOf).toBe(node.proxyOf);
      seen.set(original, node);
      trace.push([
        event,
        node.type,
        Object.keys(node).filter((key) => !['lastEach', 'indexes', 'proxyCache'].includes(key)),
        node.toJSON(),
        node.parent?.type,
        node.source?.start,
        node.source?.end,
        node.raw('before'),
        node.toString(),
        node.isClean,
        Object.getOwnPropertyDescriptor(Node.prototype, 'isClean')!.get!.call(node),
      ]);
    };
    const plugin: RuntimePlugin = {
      postcssPlugin: 'read-only',
      prepare(result) {
        result.messages.push({ type: 'dependency', file: 'dependency.css' });
        return {
          Once(root, helpers) {
            expect(root.isClean).toBe(false);
            expect(helpers.Rule).toBe(Rule);
            expect(helpers.result).toBe(result);
            root.walk((node) => {
              expect(node.root().type).toBe('root');
            });
          },
        };
      },
      OnceExit(root) {
        trace.push(['OnceExit', root.type]);
      },
      Declaration: {
        '*': (node, helpers) => {
          inspect(node, 'Declaration');
          node.warn(helpers.result, 'seen');
        },
        color: (node) => inspect(node, 'color'),
      },
    };
    for (const kind of ['Root', 'Rule', 'AtRule', 'Comment']) {
      plugin[kind] = (node: Node) => inspect(node, kind);
      plugin[`${kind}Exit`] = (node: Node) => inspect(node, `${kind}Exit`);
    }
    plugin.DeclarationExit = (node) => inspect(node, 'DeclarationExit');
    const result = runPluginsWithBridgeSync(service, [plugin as AcceptedPlugin], css, {
      from: 'fixture.css',
      document: { toString: () => 'fixture-document' },
      map: false,
    });
    return {
      css: result.css,
      trace,
      messages: result.messages.map((message) =>
        message.type === 'warning'
          ? {
              text: message.text,
              plugin: message.plugin,
              line: message.line,
              column: message.column,
            }
          : message,
      ),
      root: result.root.toJSON(),
    };
  };
  try {
    expect(execute('handle')).toEqual(execute('binary'));
  } finally {
    service.close();
  }
});

native('retained wrappers, reflection, methods, and nested read-only state', () => {
  const service = createNativeService();
  const owner = new SessionOwner(service.handleAddon!, '@media all{a,b{x:y;z:w}}');
  try {
    const root = owner.root;
    expect(() => owner.markClean(new Node())).toThrow(/foreign/);
    const rule = (root.first as AtRule).first as Rule;
    const decl = rule.first as Declaration;
    expect(root).toBeInstanceOf(Root);
    expect(rule).toBeInstanceOf(Container);
    expect(rule.selectors).toEqual(['a', 'b']);
    expect(decl).toBe(rule.nodes[0]);
    expect(decl.parent).toBe(rule);
    expect(decl.toProxy()).toBe(decl);
    expect(decl.proxyOf).toBe(decl);
    expect(decl.next()!.prev()).toBe(decl);
    expect(decl.root()).toBe(root);
    expect(decl.source!.input).toBe(root.source!.input);
    expect(Object.getOwnPropertyDescriptor(rule, 'nodes')!.value[0]).toBe(decl);
    expect(Object.getPrototypeOf(decl)).toBe(Declaration.prototype);
    expect(decl.toString()).toBe('x:y;');
    expect(decl.toString((_node, builder) => builder('custom'))).toBe('custom');
    const visited: string[] = [];
    root.walkDecls(/x|z/, (node) => {
      visited.push(node.prop);
    });
    expect(visited).toEqual(['x', 'z']);
    expect(rule.each(() => false)).toBe(false);
    expect(rule.every((node) => node.type === 'decl')).toBe(true);
    expect(rule.some((node) => node === decl)).toBe(true);
    for (const mutate of [
      () => {
        decl.value = 'changed';
      },
      () => Object.defineProperty(decl, 'value', { value: 'changed' }),
      () => Reflect.deleteProperty(decl, 'value'),
      () => Object.setPrototypeOf(decl, {}),
      () => Object.preventExtensions(decl),
      () => rule.nodes.push(decl),
      () => {
        decl.raws.before = ' ';
      },
      () => Object.defineProperty(decl.raws, 'before', { value: ' ' }),
      () => Reflect.deleteProperty(decl.raws, 'before'),
      () => Object.setPrototypeOf(decl.raws, {}),
      () => Object.preventExtensions(decl.raws),
      () => {
        decl.source!.input.css = 'changed';
      },
      () => {
        Object.getOwnPropertyDescriptor(decl, 'raws')!.value.before = ' ';
      },
      () => decl.remove(),
    ])
      expect(mutate).toThrow(/support/);
    service.close();
    expect(decl.toString()).toBe('x:y;'); // Service shutdown does not close retained arenas.
    expect(owner.session.stringify()).toBe('@media all{a,b{x:y;z:w}}');
  } finally {
    owner.session.close();
    service.close();
  }
});

native('boundary calls depend on pages, not property reads', () => {
  const service = createNativeService();
  const addon = service.handleAddon!;
  const calls = new Map<string, number>();
  const instrumented = Object.fromEntries(
    Object.getOwnPropertyNames(addon).map((key) => [
      key,
      (...args: unknown[]) => {
        calls.set(key, (calls.get(key) ?? 0) + 1);
        return Reflect.apply(
          (addon as unknown as Record<string, (...args: unknown[]) => unknown>)[key],
          addon,
          args,
        );
      },
    ]),
  ) as NativeHandleAddon;
  const owner = new SessionOwner(instrumented, `a{${'x:y;'.repeat(5000)}}`);
  try {
    expect(calls.get('handleReadSnapshotsV2')).toBe(2);
    const before = [...calls];
    for (let i = 0; i < 100; i++)
      owner.root.walkDecls((decl) => {
        expect(decl.value).toBe('y');
        expect(decl.parent!.type).toBe('rule');
      });
    expect([...calls]).toEqual(before);
  } finally {
    owner.session.close();
    service.close();
  }
});

native('errors, warnings, and callback side effects are not replayed', () => {
  const service = createNativeService();
  const execute = (mode: string) => {
    vi.stubEnv('POSTCSS_GO_NATIVE_AST', mode);
    try {
      runPluginsWithBridgeSync(
        service,
        [
          {
            postcssPlugin: 'syntax',
            Declaration(decl) {
              throw decl.error('bad', { word: 'red' });
            },
          },
        ],
        'a{color:red}',
        { from: 'error.css', map: false },
      );
    } catch (error) {
      const e = error as Error & { plugin: string; line: number; column: number };
      return [e.name, e.message, e.plugin, e.line, e.column];
    }
  };
  try {
    expect(execute('handle')).toEqual(execute('binary'));
    vi.stubEnv('POSTCSS_GO_NATIVE_AST', 'handle');
    let calls = 0;
    expect(() =>
      runPluginsWithBridgeSync(
        service,
        [
          {
            postcssPlugin: 'write',
            Once(root) {
              calls++;
              root.append({ prop: 'x', value: 'y' });
            },
          },
        ],
        'a{}',
        {},
      ),
    ).toThrow(/support/);
    expect(calls).toBe(1);
    expect(() =>
      runPluginsWithBridgeSync(
        service,
        [
          {
            postcssPlugin: 'async',
            Once() {
              return Promise.resolve();
            },
          },
        ],
        'a{}',
        {},
      ),
    ).toThrow(/async/i);
    expect(() =>
      runPluginsWithBridgeSync(
        service,
        [
          {
            postcssPlugin: 'replace',
            Once(root, { result }) {
              result.root = root;
            },
          },
        ],
        'a{}',
        {},
      ),
    ).toThrow(/result.root/);
  } finally {
    service.close();
  }
});

test('execution plan reports capability requirements and fallback reasons', () => {
  expect(planHandleExecution('auto', undefined, false)).toMatchObject({
    runtime: 'binary',
    reason: 'callback access requirements are unknown',
    requiredCapabilities: [31],
  });
  expect(planHandleExecution('binary', undefined, false).runtime).toBe('binary');
  expect(planHandleExecution('handle', undefined, false).runtime).toBe('unsupported');
  expect(planHandleExecution('handle', undefined, true).reason).toBe('source maps');
  expect(() => planHandleExecution('unknown', undefined, false)).toThrow(/invalid/);
});

native('Document wrappers and visitor order use the same identity cache', () => {
  const service = createNativeService();
  const original = service.handleAddon!;
  const addon = Object.fromEntries(
    Object.getOwnPropertyNames(original).map((key) => [key, Reflect.get(original, key)]),
  ) as NativeHandleAddon;
  addon.handleReadSnapshotsV2 = (session, ids) => {
    const rows = JSON.parse(original.handleReadSnapshotsV2!(session, ids));
    rows[0].type = 'document';
    rows[1].type = 'root';
    delete rows[0].source;
    return JSON.stringify(rows);
  };
  vi.stubEnv('POSTCSS_GO_NATIVE_AST', 'handle');
  const trace: string[] = [];
  const facadeService = {
    capabilities: service.capabilities,
    handleAddon: addon,
    parseSync: service.parseSync.bind(service),
    stringifyResultSync: service.stringifyResultSync.bind(service),
  };
  try {
    const result = runPluginsWithBridgeSync(
      facadeService,
      [
        {
          postcssPlugin: 'document',
          Once(root) {
            expect(root).toBeInstanceOf(Root);
            trace.push('Once');
          },
          Document(node) {
            expect(node).toBeInstanceOf(Document);
            trace.push('Document');
          },
          Root(root) {
            expect(root.parent).toBeInstanceOf(Document);
            expect(root.parent!.first).toBe(root);
            trace.push('Root');
          },
          Declaration() {
            trace.push('Declaration');
          },
          RootExit() {
            trace.push('RootExit');
          },
          DocumentExit() {
            trace.push('DocumentExit');
          },
          OnceExit() {
            trace.push('OnceExit');
          },
        },
      ],
      'a{x:y}',
      {},
    );
    expect(result.root).toBeInstanceOf(Document);
    expect(trace).toEqual([
      'Once',
      'Document',
      'Root',
      'Declaration',
      'RootExit',
      'DocumentExit',
      'OnceExit',
    ]);
  } finally {
    service.close();
  }
});

native('snapshot failures close their arenas and negotiation fails closed', () => {
  const service = createNativeService();
  const original = service.handleAddon!;
  const copy = () =>
    Object.fromEntries(
      Object.getOwnPropertyNames(original).map((key) => [key, Reflect.get(original, key)]),
    ) as NativeHandleAddon;
  try {
    for (const value of [
      '{}',
      '[]',
      '[{"id":900,"type":"root"}]',
      '[{"id":1,"type":"unknown"}]',
      'invalid',
    ]) {
      const addon = copy();
      const close = vi.fn(original.handleCloseV2);
      addon.handleCloseV2 = close;
      addon.handleReadSnapshotsV2 = () => value;
      expect(() => new SessionOwner(addon, '')).toThrow();
      expect(close).toHaveBeenCalledTimes(1);
    }
    const noSnapshots = copy();
    delete noSnapshots.handleReadSnapshotsV2;
    expect(planHandleExecution('handle', noSnapshots, false).runtime).toBe('unsupported');
    const throwing = copy();
    Object.defineProperty(throwing, 'handleReadSnapshotsV2', {
      get() {
        throw new Error('skew');
      },
    });
    expect(planHandleExecution('handle', throwing, false).reason).toMatch(/negotiation/);
    const old = copy();
    old.handleProtocolInfo = () => ({
      ...original.handleProtocolInfo(),
      capabilities: new Uint32Array([15]),
    });
    expect(planHandleExecution('handle', old, false).runtime).toBe('unsupported');
    expect(planHandleExecution('handle', original, false, [async () => {}]).reason).toBe(
      'async callbacks',
    );
    expect(
      planHandleExecution('handle', original, false, [{ Declaration: { x: async () => {} } }])
        .reason,
    ).toBe('async callbacks');
    expect(
      planHandleExecution('handle', original, false, [
        null,
        { Declaration: null, lowercase: async () => {} },
      ]).runtime,
    ).toBe('handle-readonly');
  } finally {
    service.close();
  }
});

native.each(['a{', 'a{x}', '/* unfinished'])('parse diagnostics match binary mode: %s', (css) => {
  const service = createNativeService();
  const execute = (mode: string) => {
    vi.stubEnv('POSTCSS_GO_NATIVE_AST', mode);
    try {
      runPluginsWithBridgeSync(service, [], css, { from: 'syntax.css', map: false });
    } catch (error) {
      const e = error as Error & { line: number; column: number };
      return [e.name, e.message, e.line, e.column];
    }
  };
  try {
    expect(execute('handle')).toEqual(execute('binary'));
  } finally {
    service.close();
  }
});

native(
  'async processor facade honors forced handle selection without a live binary bridge',
  async () => {
    const service = createNativeService();
    const parse = vi.fn(service.parse.bind(service));
    vi.stubEnv('POSTCSS_GO_NATIVE_AST', 'handle');
    try {
      const result = await runPluginsWithBridge(
        {
          capabilities: service.capabilities,
          handleAddon: service.handleAddon,
          parse,
          parseSync: service.parseSync.bind(service),
          stringifyResult: service.stringifyResult.bind(service),
        },
        [
          {
            postcssPlugin: 'read',
            Once(root) {
              expect(root.first).toBeInstanceOf(Rule);
            },
          },
        ],
        'a{}',
        { map: false },
      );
      expect(result.css).toBe('a{}');
      expect(parse).not.toHaveBeenCalled();
    } finally {
      service.close();
    }
  },
);
