import { SourceMapConsumer, type RawSourceMap } from 'source-map-js';
import upstream from 'postcss';
import { expect, test, vi } from 'vitest';
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

native.each([
  '',
  '/* hello */\n@charset "utf-8"; @media screen { a,b { color: red !important; --x: é } }',
  'a{};\n',
  '😀 {x:é}',
  '\uFEFFa{x:y}',
])('read-only handle visitors preserve identity and traces: %j', (css) => {
  const service = createNativeService();
  const execute = () => {
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
    expect(execute()).toBeDefined();
  } finally {
    service.close();
  }
});

native('retained wrappers, reflection, methods, and nested read-only state', () => {
  const service = createNativeService();
  const owner = new SessionOwner(service.handleBridge!, '@media all{a,b{x:y;z:w}}');
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
  const addon = service.handleBridge!;
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
    expect(calls.get('handleReadSnapshots')).toBe(2);
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
  const execute = () => {
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
    expect(execute()).toBeDefined();
    let calls = 0;
    const structural = runPluginsWithBridgeSync(
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
    );
    expect(calls).toBe(1);
    expect(structural.css).toContain('x');
    expect(structural.css).toContain('y');
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
  expect(planHandleExecution(undefined, false)).toMatchObject({
    runtime: 'unsupported',
    reason: 'handle facade unavailable',
  });
  expect(planHandleExecution(undefined, true).reason).toBe('handle facade unavailable');
});

native('Document wrappers and visitor order use the same identity cache', () => {
  const service = createNativeService();
  const original = service.handleBridge!;
  const addon = Object.fromEntries(
    Object.getOwnPropertyNames(original).map((key) => [key, Reflect.get(original, key)]),
  ) as NativeHandleAddon;
  addon.handleReadSnapshots = (session, ids) => {
    const rows = JSON.parse(original.handleReadSnapshots!(session, ids));
    rows[0].type = 'document';
    rows[1].type = 'root';
    delete rows[0].source;
    return JSON.stringify(rows);
  };
  const trace: string[] = [];
  const facadeService = {
    capabilities: service.capabilities,
    handleBridge: addon,
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
  const original = service.handleBridge!;
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
      const close = vi.fn(original.handleClose);
      addon.handleClose = close;
      addon.handleReadSnapshots = () => value;
      expect(() => new SessionOwner(addon, '')).toThrow();
      expect(close).toHaveBeenCalledTimes(1);
    }
    const noSnapshots = copy();
    delete noSnapshots.handleReadSnapshots;
    expect(planHandleExecution(noSnapshots, false).runtime).toBe('unsupported');
    const throwing = copy();
    Object.defineProperty(throwing, 'handleReadSnapshots', {
      get() {
        throw new Error('skew');
      },
    });
    expect(planHandleExecution(throwing, false).reason).toMatch(/unavailable/);
    const old = copy();
    old.handleProtocolInfo = () => ({
      ...original.handleProtocolInfo(),
      capabilities: new Uint32Array([15]),
    });
    expect(planHandleExecution(old, false).runtime).toBe('unsupported');
    expect(planHandleExecution(original, false, [async () => {}]).runtime).toBe('handle-full');
    expect(
      planHandleExecution(original, false, [{ Declaration: { x: async () => {} } }]).runtime,
    ).toBe('handle-full');
    expect(
      planHandleExecution(original, false, [null, { Declaration: null, lowercase: async () => {} }])
        .runtime,
    ).toBe('handle-full');
  } finally {
    service.close();
  }
});

native.each(['a{', 'a{x}', '/* unfinished'])(
  'parse diagnostics report source locations: %s',
  (css) => {
    const service = createNativeService();
    const execute = () => {
      try {
        runPluginsWithBridgeSync(service, [], css, { from: 'syntax.css', map: false });
      } catch (error) {
        const e = error as Error & { line: number; column: number };
        return [e.name, e.message, e.line, e.column];
      }
    };
    try {
      expect(execute()).toBeDefined();
    } finally {
      service.close();
    }
  },
);

native('async processor facade uses the handle session without a bulk parse', async () => {
  const service = createNativeService();
  const parse = vi.fn(service.parse.bind(service));
  try {
    const result = await runPluginsWithBridge(
      {
        capabilities: service.capabilities,
        handleBridge: service.handleBridge,
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
});

native('scalar mutation handle visitors dirty-revisit changed declarations', () => {
  const service = createNativeService();
  const execute = () => {
    const trace: string[] = [];
    const plugins: AcceptedPlugin[] = [
      {
        postcssPlugin: 'scalars',
        Rule(rule) {
          trace.push(`rule:${rule.selector}`);
          if (rule.selector === 'a') rule.selector = 'a.hero';
        },
        AtRule(atRule) {
          trace.push(`atrule:${atRule.name}:${atRule.params}`);
          if (atRule.name === 'media') atRule.params = 'print';
        },
        Declaration(decl) {
          trace.push(`decl:${decl.prop}:${decl.value}:${decl.important}`);
          if (decl.prop === 'color') {
            decl.value = 'navy';
            decl.important = true;
            decl.prop = 'background';
          }
        },
        Comment(comment) {
          trace.push(`comment:${comment.text}`);
          if (comment.text === 'note') comment.text = 'ok';
        },
      },
      {
        postcssPlugin: 'rewalk',
        Declaration(decl) {
          trace.push(`rewalk:${decl.prop}:${decl.value}`);
          if (decl.value === 'navy') decl.value = 'teal';
        },
      },
    ];
    const result = runPluginsWithBridgeSync(
      service,
      plugins,
      '/* note */\n@media screen { a { color: red } }',
      { from: 'scalar.css', map: false },
    );
    return { css: result.css, trace };
  };
  try {
    expect(execute()).toBeDefined();
  } finally {
    service.close();
  }
});

native('throw after scalar writes flushes patches without replay', () => {
  const service = createNativeService();
  const execute = () => {
    let calls = 0;
    try {
      runPluginsWithBridgeSync(
        service,
        [
          {
            postcssPlugin: 'throw-after-write',
            Declaration(decl) {
              calls += 1;
              decl.value = 'navy';
              decl.important = true;
              throw decl.error('boom');
            },
          },
        ],
        'a{color:red}',
        { from: 'throw.css', map: false },
      );
    } catch (error) {
      const e = error as Error & { plugin: string };
      return { calls, name: e.name, message: e.message, plugin: e.plugin };
    }
  };
  try {
    expect(execute()).toBeDefined();
  } finally {
    service.close();
  }
});

native('mutable scalar SessionOwner preserves read-after-write ordering', () => {
  const service = createNativeService();
  const owner = new SessionOwner(service.handleBridge!, 'a{color:red}', {
    mutableScalars: true,
  });
  try {
    const decl = (owner.root.first as Rule).first as Declaration;
    decl.value = 'blue';
    expect(decl.value).toBe('blue');
    decl.important = true;
    decl.prop = 'background';
    expect([decl.prop, decl.value, decl.important]).toEqual(['background', 'blue', true]);
    owner.flushPatches();
    expect(owner.session.stringify()).toBe('a{background:blue !important}');
    expect(() => decl.remove()).toThrow(/support/);
  } finally {
    owner.session.close();
    service.close();
  }
});

native('mutable structure SessionOwner applies append/remove/raws immediately', () => {
  const service = createNativeService();
  const owner = new SessionOwner(service.handleBridge!, 'a{color:red}', {
    mutableStructure: true,
  });
  try {
    const rule = owner.root.first as Rule;
    rule.append({ prop: 'margin', value: '0' });
    expect(rule.nodes).toHaveLength(2);
    expect(owner.session.stringify()).toContain('margin');
    rule.raws.semicolon = true;
    const cloned = rule.clone({ selector: 'b' });
    expect(cloned).toBeInstanceOf(Rule);
    expect((cloned as Rule).selector).toBe('b');
    rule.first!.remove();
    expect(rule.nodes).toHaveLength(1);
    expect(owner.session.stringify()).toMatch(/margin:\s*0/);
  } finally {
    owner.session.close();
    service.close();
  }
});

native('handle-full plan supports maps and nested structural plugins', async () => {
  const service = createNativeService();
  const nested = (await import('postcss-nested')).default;
  try {
    const plan = planHandleExecution(service.handleBridge!, true, []);
    expect(plan.runtime).toBe('handle-full');
    const result = await runPluginsWithBridge(
      service,
      [nested()],
      '.card { &:hover { color: blue } }',
      { from: 'map.css', map: { inline: false, annotation: false } },
    );
    expect(result.css).toContain('.card:hover');
    expect(result.map).toBeTruthy();
    expect(
      (result as { nativePlan?: { hydration: boolean; runtime: string } }).nativePlan,
    ).toMatchObject({
      hydration: false,
      runtime: 'handle-full',
    });
  } finally {
    service.close();
  }
});

native('live first/last/next/prev track structural mutations', () => {
  const service = createNativeService();
  const owner = new SessionOwner(service.handleBridge!, 'a{color:red;margin:0}', {
    mutableStructure: true,
  });
  try {
    const rule = owner.root.first as Rule;
    const first = rule.first as Declaration;
    const last = rule.last as Declaration;
    expect(rule.first).toBe(first);
    expect(rule.last).toBe(last);
    expect(first.next()).toBe(last);
    expect(last.prev()).toBe(first);
    expect(first.prev()).toBeUndefined();
    expect(last.next()).toBeUndefined();
    first.remove();
    expect(rule.first).toBe(last);
    expect(rule.last).toBe(last);
    expect(last.prev()).toBeUndefined();
    rule.prepend({ prop: 'display', value: 'block' });
    expect(rule.first!.prop).toBe('display');
    expect(rule.first!.next()).toBe(last);
    expect(last.prev()).toBe(rule.first!);
  } finally {
    owner.session.close();
    service.close();
  }
});

native('raws differentials survive structural clone and semicolon writes', () => {
  const service = createNativeService();
  const execute = () => {
    let once = false;
    return runPluginsWithBridgeSync(
      service,
      [
        {
          postcssPlugin: 'raws',
          Rule(rule) {
            if (once || rule.selector !== 'a') return;
            once = true;
            rule.raws.semicolon = true;
            rule.append({ prop: 'margin', value: '0', raws: { before: ' ' } });
            const copy = rule.clone({ selector: 'b' });
            rule.after(copy);
          },
        },
      ],
      'a{color:red}',
      { from: 'raws.css', map: false },
    ).css;
  };
  try {
    expect(execute()).toBeDefined();
  } finally {
    service.close();
  }
});

native('structural mutation during traversal visits inserted siblings', () => {
  const service = createNativeService();
  try {
    const seen: string[] = [];
    const result = runPluginsWithBridgeSync(
      service,
      [
        {
          postcssPlugin: 'insert-while-walking',
          Rule(rule) {
            rule.walkDecls((decl) => {
              seen.push(decl.prop);
              if (
                decl.prop === 'color' &&
                !rule.some(
                  (node) => node.type === 'decl' && (node as Declaration).prop === 'opacity',
                )
              ) {
                rule.append({ prop: 'opacity', value: '1' });
              }
            });
          },
        },
      ],
      'a{color:red}',
      { from: 'walk.css', map: false },
    );
    expect(seen).toContain('color');
    expect(seen).toContain('opacity');
    expect(result.css).toMatch(/opacity:\s*1/);
    expect(
      (result as { nativePlan?: { visits: number; hydration: boolean; runtime: string } })
        .nativePlan,
    ).toMatchObject({
      hydration: false,
      runtime: 'handle-full',
      visits: expect.any(Number),
    });
    expect((result as { nativePlan?: { visits: number } }).nativePlan!.visits).toBeGreaterThan(0);
  } finally {
    service.close();
  }
});

native('async retained Result.root stays Go-backed after await', async () => {
  const service = createNativeService();
  const parse = vi.spyOn(service, 'parseSync');
  try {
    const result = await runPluginsWithBridge(
      service,
      [
        {
          postcssPlugin: 'async-mutate',
          async Declaration(decl) {
            await Promise.resolve();
            if (decl.prop === 'color' && decl.value !== 'navy') decl.value = 'navy';
          },
        },
      ],
      'a{color:red}',
      { from: 'async.css', map: false },
    );
    expect(parse).not.toHaveBeenCalled();
    expect(result.css).toContain('navy');
    const root = result.root;
    expect(root.first).toBeInstanceOf(Rule);
    expect((root.first as Rule).first).toMatchObject({ prop: 'color', value: 'navy' });
    expect(root.toString()).toBe(result.css);
    expect(
      (result as { nativePlan?: { hydration: boolean; runtime: string; visits: number } })
        .nativePlan,
    ).toMatchObject({
      hydration: false,
      runtime: 'handle-full',
      visits: expect.any(Number),
    });
  } finally {
    service.close();
  }
});

native('capability-complete bridges select handle-full', () => {
  const service = createNativeService();
  expect(planHandleExecution(service.handleBridge!, false, []).runtime).toBe('handle-full');
  expect(planHandleExecution(service.handleBridge!, true, []).runtime).toBe('handle-full');
  expect(
    planHandleExecution(service.handleBridge!, false, [
      {
        postcssPlugin: 'async',
        async Once() {},
      },
    ]).runtime,
  ).toBe('handle-full');
  service.close();
});

native('handle stringifyMap resolves nested block ends like upstream', async () => {
  const css = '@media screen {\n  .a {\n    color: red;\n    .b { color: blue }\n  }\n}\n';
  const service = createNativeService();
  const owner = new SessionOwner(service.handleBridge!, css, {
    from: 'in.css',
    mutableStructure: true,
  });
  let mapped: { map: string };
  try {
    mapped = owner.session.stringifyMap(owner.session.rootHandle, {
      from: 'in.css',
      to: 'out.css',
      absolute: false,
      preserveAnnotation: false,
    });
  } finally {
    owner.session.close();
    service.close();
  }

  const upstreamResult = await upstream([{ postcssPlugin: 'noop', Declaration() {} }]).process(
    css,
    { from: 'in.css', to: 'out.css', map: { inline: false, annotation: false } },
  );

  const handleConsumer = new SourceMapConsumer(JSON.parse(mapped.map) as RawSourceMap);
  const expected: string[] = [];
  const actual: string[] = [];
  new SourceMapConsumer(upstreamResult.map.toJSON() as unknown as RawSourceMap).eachMapping(
    (mapping) => {
      const position = handleConsumer.originalPositionFor({
        line: mapping.generatedLine,
        column: mapping.generatedColumn,
      });
      expected.push(
        `${mapping.generatedLine}:${mapping.generatedColumn} -> ${mapping.originalLine}:${mapping.originalColumn}`,
      );
      actual.push(
        `${mapping.generatedLine}:${mapping.generatedColumn} -> ${position.line}:${position.column}`,
      );
    },
  );
  expect(actual).toEqual(expected);
});
