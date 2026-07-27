import postcss, { type AcceptedPlugin } from 'postcss';
import { SourceMapConsumer } from 'source-map-js';
import { expect, test, vi } from 'vitest';

import { fromAst } from '../src/ast.ts';
import { runPluginsWithBridge } from '../src/plugin-runtime.ts';
import type { AstNode, ProcessResult } from '../src/types.ts';

function bridge() {
  let sourceCss = '';
  const stringify = vi.fn(async (ast: AstNode) => fromAst(ast).toString());
  return {
    parse: vi.fn(async (css: string) => {
      sourceCss = css;
      return { root: postcss.parse(css).toJSON() as AstNode };
    }),
    process: vi.fn(
      async (css: string): Promise<ProcessResult> => ({
        css,
        map: JSON.stringify({
          version: 3,
          sources: ['input.css'],
          sourcesContent: [css],
          names: [],
          mappings: 'AAAA',
        }),
        root: postcss.parse(css).toJSON() as AstNode,
        messages: [],
      }),
    ),
    stringify,
    stringifyResult: vi.fn(
      async (ast: AstNode, options: { from?: string; map?: unknown } = {}) => ({
        css: await stringify(ast),
        ...(options.map
          ? {
              map: JSON.stringify({
                version: 3,
                sources: [options.from ?? 'to.css'],
                sourcesContent: [sourceCss],
                names: [],
                mappings: 'AAAA',
              }),
            }
          : {}),
      }),
    ),
  };
}

test('plugin runtime runs lifecycle and named visitors over the bridge AST', async () => {
  const service = bridge();
  const events: string[] = [];
  const plugin = {
    postcssPlugin: 'bridge-lifecycle',
    prepare(result) {
      result.messages.push({ type: 'dependency', file: 'tokens.css' });
      return {
        Once: () => events.push('Once'),
        Root: () => events.push('Root'),
        Rule: () => events.push('Rule'),
        Declaration: {
          color(decl) {
            events.push('Declaration');
            decl.value = 'blue';
          },
        },
        DeclarationExit(decl) {
          events.push('DeclarationExit');
          decl.warn(result, 'checked');
        },
        RuleExit: () => events.push('RuleExit'),
        RootExit: () => events.push('RootExit'),
        OnceExit: () => events.push('OnceExit'),
      };
    },
  } satisfies AcceptedPlugin;

  const result = await runPluginsWithBridge(service, [plugin], '.a { color: red; }', {
    from: 'input.css',
    map: false,
  });

  // Changing decl.value dirties the tree, so PostCSS rewalks once more.
  expect(events).toEqual([
    'Once',
    'Root',
    'Rule',
    'Declaration',
    'DeclarationExit',
    'RuleExit',
    'RootExit',
    'Root',
    'Rule',
    'Declaration',
    'DeclarationExit',
    'RuleExit',
    'RootExit',
    'OnceExit',
  ]);
  expect(result.css).toContain('color: blue');
  expect(result.content).toBe(result.css);
  expect(result.toString()).toBe(result.css);
  expect(result.warnings()).toEqual([
    expect.objectContaining({ type: 'warning', text: 'checked', plugin: 'bridge-lifecycle' }),
    expect.objectContaining({ type: 'warning', text: 'checked', plugin: 'bridge-lifecycle' }),
  ]);
  expect(service.parse).toHaveBeenCalledOnce();
  expect(service.stringifyResult).toHaveBeenCalledOnce();
  expect(service.process).not.toHaveBeenCalled();
});

test('plugin runtime builds AST-based maps that keep original source content', async () => {
  const service = bridge();
  const original = '.a { color: red; }';
  const plugin = {
    postcssPlugin: 'to-blue',
    Declaration(decl) {
      decl.value = 'blue';
    },
  } satisfies AcceptedPlugin;

  const result = await runPluginsWithBridge(service, [plugin], original, {
    from: 'input.css',
    map: { inline: false },
  });

  expect(result.css).toContain('color: blue');
  expect(service.process).not.toHaveBeenCalled();
  expect(service.stringifyResult).toHaveBeenCalledOnce();

  const map = JSON.parse(result.map ?? '{}') as {
    sources: string[];
    sourcesContent: string[];
    mappings: string;
  };
  expect(map.sources).toEqual(['input.css']);
  expect(map.sourcesContent).toEqual([original]);
  expect(map.mappings.length).toBeGreaterThan(0);

  const consumer = await new SourceMapConsumer(result.map ?? '');
  const originalPos = consumer.originalPositionFor({ line: 1, column: 0 });
  expect(originalPos.source).toBe('input.css');
  expect(originalPos.line).toBe(1);
});

test('plugin runtime attributes callback errors to the active plugin', async () => {
  const service = bridge();
  const plugin = {
    postcssPlugin: 'broken-plugin',
    Rule() {
      throw new Error('broken');
    },
  } satisfies AcceptedPlugin;

  await expect(
    runPluginsWithBridge(service, [plugin], '.a {}', { from: 'input.css', map: false }),
  ).rejects.toMatchObject({ message: 'broken', plugin: 'broken-plugin' });
});

test('named AtRule visitors run general filters before specific filters', async () => {
  const events: string[] = [];
  await runPluginsWithBridge(
    bridge(),
    [
      {
        postcssPlugin: 'order',
        AtRule: {
          '*': () => events.push('AtRule:*'),
          media: () => events.push('AtRule:media'),
        },
        AtRuleExit: {
          '*': () => events.push('AtRuleExit:*'),
          media: () => events.push('AtRuleExit:media'),
        },
      },
    ],
    '@media x { .a{color:red} }',
    { from: 'input.css', map: false },
  );

  expect(events).toEqual(['AtRule:*', 'AtRule:media', 'AtRuleExit:*', 'AtRuleExit:media']);
});

test('dirty rewalk visits nodes appended during RootExit', async () => {
  const seen: string[] = [];
  await runPluginsWithBridge(
    bridge(),
    [
      {
        postcssPlugin: 'rewalk',
        RootExit(root) {
          if (!(root as { _done?: boolean })._done) {
            (root as { _done?: boolean })._done = true;
            root.append({ selector: '.added', nodes: [] });
          }
        },
        Rule(rule) {
          seen.push(rule.selector);
        },
      },
    ],
    '.a{}',
    { from: 'input.css', map: false },
  );

  expect(seen).toEqual(['.a', '.added']);
});

test('nodes are instanceof postcss node classes', async () => {
  let ruleIsPostcssRule = false;
  let ruleIsHelpersRule = false;
  await runPluginsWithBridge(
    bridge(),
    [
      {
        postcssPlugin: 'instanceof-check',
        Rule(rule, helpers) {
          ruleIsPostcssRule = rule instanceof postcss.Rule;
          ruleIsHelpersRule = rule instanceof helpers.postcss.Rule;
        },
      },
    ],
    '.a{}',
    { from: 'input.css', map: false },
  );

  expect(ruleIsPostcssRule).toBe(true);
  expect(ruleIsHelpersRule).toBe(true);
  expect(postcss.rule({ selector: '.real' }) instanceof postcss.Rule).toBe(true);
  expect({} instanceof postcss.Rule).toBe(false);
});

test('normalizePlugins supports creators, packs, and legacy transformers', async () => {
  const events: string[] = [];

  function creator() {
    return {
      postcssPlugin: 'from-creator',
      Once() {
        events.push('creator');
      },
    };
  }
  creator.postcss = true;

  const withPostcssField = {
    postcss: {
      postcssPlugin: 'from-field',
      Once() {
        events.push('field');
      },
    },
  };

  const pack = {
    plugins: [
      {
        postcssPlugin: 'from-pack',
        Once() {
          events.push('pack');
        },
      },
    ],
  };

  function legacy(root: { append: (node: unknown) => void }) {
    events.push('legacy');
    root.append({ selector: '.legacy', nodes: [] });
  }

  const result = await runPluginsWithBridge(
    bridge(),
    [creator as AcceptedPlugin, withPostcssField as AcceptedPlugin, pack as AcceptedPlugin, legacy],
    '.a{}',
    { from: 'input.css', map: false },
  );

  expect(events).toEqual(['creator', 'field', 'pack', 'legacy']);
  expect(result.css).toContain('.legacy');
});

test('normalizePlugins rejects invalid plugins', async () => {
  await expect(
    runPluginsWithBridge(bridge(), [null as unknown as AcceptedPlugin], '.a{}', {
      from: 'input.css',
      map: false,
    }),
  ).rejects.toThrow(/is not a PostCSS plugin/);
});

test('result.warn records plugin metadata and helpers.postcss works', async () => {
  const result = await runPluginsWithBridge(
    bridge(),
    [
      {
        postcssPlugin: 'helpers-check',
        Once(root, helpers) {
          helpers.result.warn('from-result');
          const parsed = helpers.postcss.parse('.b{color:green}');
          root.append(parsed.nodes);
          expect(helpers.postcss.list.comma('a, b')).toEqual(['a', 'b']);
          expect(helpers.postcss.stringify(root)).toContain('.b');
        },
      },
    ],
    '.a{}',
    { from: 'input.css', map: false },
  );

  expect(result.warnings()).toEqual([
    expect.objectContaining({ type: 'warning', text: 'from-result', plugin: 'helpers-check' }),
  ]);
  expect(result.css).toContain('color:green');
});

test('Comment visitors run and non-root parse responses fail', async () => {
  const events: string[] = [];
  await runPluginsWithBridge(
    bridge(),
    [
      {
        postcssPlugin: 'comment-visitor',
        Comment() {
          events.push('Comment');
        },
        CommentExit() {
          events.push('CommentExit');
        },
      },
    ],
    '/* x */ .a{}',
    { from: 'input.css', map: false },
  );
  expect(events).toEqual(['Comment', 'CommentExit']);

  const broken = bridge();
  broken.parse = vi.fn(async () => ({
    root: { type: 'rule', selector: '.a', nodes: [] } as AstNode,
  }));
  await expect(
    runPluginsWithBridge(broken, [], '.a{}', { from: 'input.css', map: false }),
  ).rejects.toThrow(/not a root/);
});

test('previous map metadata is attached from annotation and opts.prev', async () => {
  const previous = JSON.stringify({ version: 3, sources: ['a.css'], names: [], mappings: 'AAAA' });
  const annotation = Buffer.from(previous, 'utf8').toString('base64');
  const css = `.a{}\n/*# sourceMappingURL=data:application/json;base64,${annotation} */`;
  const service = bridge();
  service.parse = vi.fn(async () => ({
    root: {
      type: 'root',
      source: { input: { file: 'input.css' }, start: { line: 1, column: 1, offset: 0 } },
      nodes: [{ type: 'rule', selector: '.a', nodes: [] }],
    } as AstNode,
  }));

  const result = await runPluginsWithBridge(
    service,
    [
      {
        postcssPlugin: 'noop',
        Once() {},
      },
    ],
    css,
    {
      from: 'input.css',
      map: { inline: false, prev: previous },
    },
  );

  const input = (
    result.root.source as unknown as { input?: { map?: { inline?: boolean; text?: string } } }
  )?.input;
  expect(input?.map?.inline).toBe(true);
  expect(input?.map?.text).toContain('"version":3');
});

test('AST map stringifier covers at-rules, comments, and helpers extras', async () => {
  const original =
    '@media (max-width: 1px) {\n  /* note */\n  .a { color: red !important; }\n}\n@import "x";\n';
  const result = await runPluginsWithBridge(
    bridge(),
    [
      {
        postcssPlugin: 'map-shapes',
        Once(_root, helpers) {
          expect(helpers.postcss.list.space('a b')).toEqual(['a', 'b']);
          expect(helpers.postcss.list.split('a,b', [','], true)).toEqual(['a', 'b']);
          const chunks: string[] = [];
          helpers.postcss.stringify(helpers.postcss.rule({ selector: '.x' }), (chunk) => {
            chunks.push(chunk);
          });
          expect(chunks.join('')).toContain('.x');
          expect(helpers.postcss.decl({ prop: 'color', value: 'red' })).toBeInstanceOf(
            helpers.postcss.Declaration,
          );
        },
        Declaration(decl) {
          if (decl.value === 'red') decl.value = 'blue';
        },
      },
    ],
    original,
    { from: 'input.css', map: { inline: false } },
  );

  expect(result.css).toContain('@media');
  expect(result.css).toContain('note');
  expect(result.css).toContain('color: blue !important');
  expect(result.css).toContain('@import');
  expect(JSON.parse(result.map ?? '{}').sourcesContent).toEqual([original]);
});

test('property mutations dirty the tree and trigger rewalk', async () => {
  const seen: string[] = [];
  await runPluginsWithBridge(
    bridge(),
    [
      {
        postcssPlugin: 'rewalk-on-prop',
        Declaration(decl) {
          seen.push(decl.value);
        },
        RuleExit(rule) {
          const first = rule.first as { value: string };
          if (first.value === 'red') first.value = 'blue';
        },
      },
    ],
    '.a{color:red}',
    { from: 'input.css', map: false },
  );

  expect(seen).toEqual(['red', 'blue']);
});

test('named visitors run general filters across plugins before named filters', async () => {
  const events: string[] = [];
  await runPluginsWithBridge(
    bridge(),
    [
      {
        postcssPlugin: 'a',
        AtRule: {
          '*': () => events.push('a:*'),
          media: () => events.push('a:media'),
        },
      },
      {
        postcssPlugin: 'b',
        AtRule: {
          '*': () => events.push('b:*'),
          media: () => events.push('b:media'),
        },
      },
    ],
    '@media x{.a{}}',
    { from: 'input.css', map: false },
  );

  expect(events).toEqual(['a:*', 'b:*', 'a:media', 'b:media']);
});

test('empty at-rule blocks keep braces and afterName spacing', async () => {
  const css = '@media x {}';
  const service = bridge();
  service.parse = vi.fn(async () => ({
    root: {
      type: 'root',
      nodes: [
        {
          type: 'atrule',
          name: 'media',
          params: 'x',
          block: true,
          nodes: [],
          raws: { before: '', afterName: ' ', between: ' ', after: '' },
        },
      ],
    } as AstNode,
  }));

  const noMap = await runPluginsWithBridge(service, [{ postcssPlugin: 'noop', Once() {} }], css, {
    from: 'input.css',
    map: false,
  });
  const withMap = await runPluginsWithBridge(service, [{ postcssPlugin: 'noop', Once() {} }], css, {
    from: 'input.css',
    map: { inline: false },
  });

  expect(noMap.css).toBe('@media x {}');
  expect(withMap.css).toBe('@media x {}');
});

test('callback errors include postcssNode metadata', async () => {
  await expect(
    runPluginsWithBridge(
      bridge(),
      [
        {
          postcssPlugin: 'broken-plugin',
          Declaration() {
            throw new Error('broken');
          },
        },
      ],
      '.a{color:red}',
      { from: 'input.css', map: false },
    ),
  ).rejects.toMatchObject({
    message: 'broken',
    plugin: 'broken-plugin',
    postcssNode: expect.objectContaining({ type: 'decl' }),
  });
});

test('hasPreviousMap treats map.prev false as absent', async () => {
  const service = bridge();
  service.parse = vi.fn(async () => ({
    root: {
      type: 'root',
      source: { start: { line: 1, column: 1, offset: 0 } },
      nodes: [],
    } as AstNode,
  }));

  const result = await runPluginsWithBridge(
    service,
    [{ postcssPlugin: 'noop', Once() {} }],
    '.a{}',
    { from: 'input.css', map: { prev: false } },
  );

  expect((result.root.source as unknown as { input?: unknown } | undefined)?.input).toBeUndefined();
});
