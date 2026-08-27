import { expect, test } from 'vitest';

import { defaultRaw } from '../src/ast-stringifier.ts';
import {
  AtRule,
  Comment,
  Container,
  Declaration,
  Document,
  Input,
  Node,
  ResultMap,
  Root,
  Rule,
  fromAst,
  fromJSON,
  toAst,
} from '../src/index.ts';

test('round-trips a document DTO with stylesheet roots', () => {
  const dto = {
    type: 'document' as const,
    nodes: [
      {
        type: 'root' as const,
        nodes: [
          {
            type: 'rule' as const,
            selector: 'a',
            nodes: [],
            raws: { before: '' },
          },
        ],
      },
      {
        type: 'root' as const,
        nodes: [],
      },
    ],
  };

  const document = fromAst(dto);

  expect(document).toBeInstanceOf(Document);
  expect(document.nodes).toHaveLength(2);
  expect(document.nodes[0]).toBeInstanceOf(Root);
  expect(document.nodes[0].first).toBeInstanceOf(Rule);
  expect(document.nodes[0].parent).toBe(document);
  expect(document.nodes[0].first?.parent).toBe(document.nodes[0]);
  expect(toAst(document)).toMatchObject(dto);
});

test('matches PostCSS root() semantics across a document boundary', () => {
  const document = new Document();
  const root = new Root();
  const rule = new Rule({ selector: 'a' });
  root.append(rule);
  document.append([root]);

  expect(document.root()).toBe(document);
  expect(root.root()).toBe(root);
  expect(rule.root()).toBe(root);
});

test('accepts arrays as Document children', () => {
  const document = new Document();
  const first = new Root({ raws: { before: '' } });
  const second = new Root();
  first.append(new Rule({ selector: 'a' }));
  second.append(new Rule({ selector: 'b' }));

  document.append([first, second]);

  expect(document.nodes).toEqual([first, second]);
  expect(first.parent).toBe(document);
  expect(second.parent).toBe(document);
});

test('toResult stringifies a Document and keeps its live Document root', async () => {
  const document = new Document();
  document.append(new Root({ nodes: [{ type: 'rule', selector: 'a', nodes: [] }] }));
  let closed = 0;
  const service = {
    async parse() {
      throw new Error('parse should not be called');
    },
    async process() {
      throw new Error('process should not be called');
    },
    async stringify() {
      throw new Error('stringify should not be called');
    },
    async stringifyResult() {
      return { css: 'a {}' };
    },
    async close() {
      closed += 1;
    },
  };

  const result = await document.toResult({}, service);

  expect(result.css).toBe('a {}');
  expect(result.root).toBe(document);
  expect(result.root.type).toBe('document');
  expect(typeof result.root.walk).toBe('function');
  expect(result.messages).toEqual([]);
  expect(closed).toBe(0);
});

test('toResult generates source maps via stringifyResult', async () => {
  const document = new Document();
  document.append(new Root({ nodes: [{ type: 'rule', selector: 'a', nodes: [] }] }));
  let stringified = false;
  const service = {
    async parse() {
      throw new Error('parse should not be called');
    },
    async process() {
      throw new Error('process should not be called');
    },
    async stringify() {
      throw new Error('stringify should not be called');
    },
    async stringifyResult(_ast: unknown, options: { map?: boolean }) {
      stringified = options.map === true;
      return { css: 'a {}', map: 'map', mapFile: 'a.css.map' };
    },
    async close() {},
  };

  const result = await document.toResult({ map: true }, service);

  expect(stringified).toBe(true);
  expect(result.map).toBeInstanceOf(ResultMap);
  expect(result.map?.toString()).toBe('map');
  expect(result.mapFile).toBe('a.css.map');
  expect(result.root).toBe(document);
});

test('supports PostCSS-style walking and filtered visitors', () => {
  const root = new Root({
    nodes: [
      {
        type: 'rule',
        selector: 'a, :is(b, c)',
        nodes: [
          { type: 'decl', prop: 'color', value: 'red' },
          { type: 'comment', text: 'note' },
        ],
      },
      { type: 'atrule', name: 'media', params: 'screen', nodes: [] },
    ],
  });
  const visited: string[] = [];

  root.walkDecls('color', (decl) => visited.push(`${decl.prop}:${decl.value}`));
  root.walkComments((comment) => visited.push(comment.text));
  root.walkAtRules(/^med/, (atRule) => visited.push(atRule.name));
  root.walkRules((rule) => visited.push(rule.selector));

  expect(visited).toEqual(['color:red', 'note', 'media', 'a, :is(b, c)']);
});

test('filtered walkers recognize custom nodes by their PostCSS type', () => {
  class CustomDeclaration extends Node {
    prop = 'custom';
    value = 'value';

    constructor() {
      super({ type: 'decl' });
    }
  }

  const root = new Root();
  root.push(new CustomDeclaration() as unknown as Declaration);
  const visited: Node[] = [];

  root.walkDecls((node) => visited.push(node));

  expect(visited).toEqual([root.first]);
});

test('supports Node and Container mutation helpers', () => {
  const root = new Root();
  const rule = new Rule({ selector: 'a, :is(b, c)', raws: { before: '  ', between: ' ' } });
  const decl = new Declaration({
    prop: '--color',
    value: 'red',
    raws: { before: '  ', after: ' ' },
  });
  rule.append(decl);
  root.append(rule);

  expect(rule.selectors).toEqual(['a', ':is(b, c)']);
  rule.selectors = ['a', 'b'];
  expect(rule.selector).toBe('a, b');
  expect(decl.variable).toBe(true);

  const cloned = decl.cloneBefore({ value: 'blue' });
  expect(rule.nodes).toHaveLength(2);
  expect(cloned).toBe(rule.first);
  cloned.remove();
  expect(rule.nodes).toHaveLength(1);

  rule.assign({ selector: 'button' }).cleanRaws();
  expect(rule.selector).toBe('button');
  expect(rule.raws).toEqual({});
});

test('normalizes plain PostCSS node-shaped objects', () => {
  const root = new Root();
  root.append({ selector: '.a', nodes: [] } as never);
  root.append({ prop: 'color', value: 1 } as never);
  root.append({ text: 'comment' });

  expect(root.nodes[0]).toBeInstanceOf(Rule);
  expect(root.nodes[1]).toBeInstanceOf(Declaration);
  expect(root.nodes[2]).toBeInstanceOf(Comment);
  expect((root.nodes[1] as Declaration).value).toBe('1');
});

test('provides synchronous PostCSS-style stringification and raw helpers', () => {
  const root = new Root({ raws: { semicolon: true } });
  const rule = new Rule({ selector: '.a', raws: { before: '', between: ' ', semicolon: true } });
  rule.append(
    new Declaration({ prop: 'color', value: 'red', raws: { before: '', between: ': ' } }),
  );
  root.append(rule);

  expect(rule.raw('between', 'beforeOpen')).toBe(' ');
  expect(rule.toString()).toBe('.a {color: red;\n}');
  expect(String(root)).toBe('.a {color: red;\n}');
});

test('matches PostCSS default formatting and comment whitespace raws', () => {
  const root = new Root({
    nodes: [new Declaration({ prop: 'a', value: 'b' }), new Declaration({ prop: 'c', value: 'd' })],
  });
  const comment = new Comment({
    text: 'note',
    raws: { left: ' ', right: ' ' },
  });

  expect(root.toString()).toBe('a: b;\nc: d');
  expect(comment.toString()).toBe('/* note */');
});

test('preserves empty at-rule blocks and afterName spacing', () => {
  const emptyBlock = fromAst({
    type: 'atrule',
    name: 'media',
    params: 'x',
    block: true,
    nodes: [],
    raws: { afterName: ' ', between: ' ', after: '' },
  });
  const importRule = fromAst({
    type: 'atrule',
    name: 'import',
    params: '"y"',
    raws: { afterName: ' ' },
  });

  expect(emptyBlock.toString()).toBe('@media x {}');
  expect(importRule.toString()).toBe('@import "y"');
  expect(toAst(emptyBlock)).toMatchObject({ block: true, nodes: [] });
  expect(toAst(importRule)).not.toHaveProperty('block');
  expect(toAst(importRule)).not.toHaveProperty('nodes');
});

test('keeps childless at-rule nodes undefined until a child is appended', () => {
  const atRule = fromAst({
    type: 'atrule',
    name: 'charset',
    params: '"UTF-8"',
  });

  expect(atRule.nodes).toBeUndefined();
  atRule.append({ prop: 'color', value: 'red' });
  expect(atRule.nodes).toHaveLength(1);
  expect(atRule.toString()).toContain('{');
});

test('toProxy marks property writes dirty for rewalk', () => {
  const decl = new Declaration({ prop: 'color', value: 'red' });
  const root = new Root();
  const rule = new Rule({ selector: '.a' });
  rule.append(decl);
  root.append(rule);
  root.markClean();
  rule.markClean();
  decl.markClean();

  const proxy = decl.toProxy();
  proxy.value = 'blue';

  expect(decl.value).toBe('blue');
  expect(decl.isClean).toBe(false);
  expect(root.isClean).toBe(false);
  expect(rule.first?.toProxy()).toBe(decl.toProxy());
});

test('attaches PostCSS-style warning and syntax error metadata', () => {
  const decl = new Declaration({
    prop: 'color',
    value: 'red',
    source: {
      start: { line: 2, column: 3, offset: 4 },
      end: { line: 2, column: 12, offset: 13 },
      file: 'input.css',
    },
  });
  const result: { messages?: Array<Record<string, unknown>> } = {};
  const warning = decl.warn(result, 'check me', { plugin: 'test' });
  const error = decl.error('broken', { plugin: 'test' }) as Error & {
    line: number;
    column: number;
    file: string;
  };

  expect(warning.plugin).toBe('test');
  expect(result.messages).toHaveLength(1);
  expect(error.name).toBe('CssSyntaxError');
  expect(error.line).toBe(2);
  expect(error.column).toBe(3);
  expect(error.file).toBe('input.css');
});

test('matches indexed Container mutations and mutation-safe iteration', () => {
  const root = new Root({
    nodes: [
      { type: 'comment', text: 'a' },
      { type: 'comment', text: 'b' },
    ],
  });
  const visited: string[] = [];

  root.each((node) => {
    visited.push((node as Comment).text);
    if ((node as Comment).text === 'a') node.cloneBefore({ text: 'clone' });
  });
  root.insertAfter(0, { text: 'after' });
  root.removeChild(0);

  expect(visited).toEqual(['a', 'b']);
  expect(root.nodes.map((node) => (node as Comment).text)).toEqual(['after', 'a', 'b']);
});

test('replaceValues accepts a string replacement', () => {
  const root = new Root({
    nodes: [{ prop: 'content', value: 'foo foo' }],
  });

  root.replaceValues(/foo/g, 'bar');

  expect((root.first as Declaration).value).toBe('bar bar');
});

test('recomputes insertion indexes when moving existing children', () => {
  const root = new Root({
    nodes: [
      { type: 'comment', text: 'a' },
      { type: 'comment', text: 'b' },
      { type: 'comment', text: 'c' },
    ],
  });
  const [a, b, c] = root.nodes;

  root.insertBefore(c, a);
  expect(root.nodes).toEqual([b, a, c]);

  root.insertAfter(b, c);
  expect(root.nodes).toEqual([b, c, a]);
});

test('normalizes CSS strings, nested arrays, and undefined children', () => {
  const root = new Root();

  root.append(undefined, ['a { color: red }', [{ text: 'note' }]]);

  expect(root.nodes).toHaveLength(2);
  expect(root.first).toBeInstanceOf(Rule);
  expect((root.first as Rule).first).toBeInstanceOf(Declaration);
  expect(root.last).toBeInstanceOf(Comment);
  expect(root.nodes.every((node) => node.source === undefined)).toBe(true);
});

test('keeps replaceWith stable when the replacement includes the current node', () => {
  const detached = new Comment({ text: 'detached' });
  expect(detached.replaceWith({ text: 'ignored' })).toBe(detached);

  const root = new Root({ nodes: [{ text: 'current' }] });
  const current = root.first as Comment;
  current.replaceWith({ text: 'before' }, current, { text: 'after' });

  expect(root.nodes.map((node) => (node as Comment).text)).toEqual(['before', 'current', 'after']);
});

test('preserves custom nodes, properties, prototypes, and JSON values', () => {
  class Word extends Node {
    value: string;

    constructor(value: string) {
      super({ type: 'word', metadata: { toJSON: () => 'serialized' } });
      this.value = value;
    }
  }

  const root = new Container({ type: 'custom-root', nodes: [new Word('hello')] });
  const clone = root.first?.clone() as Word;
  const json = root.toJSON() as {
    inputs: unknown[];
    nodes: Array<{ metadata: string; type: string; value: string }>;
  };
  const hydrated = fromJSON(json) as Container;

  expect(clone).toBeInstanceOf(Word);
  expect(clone.value).toBe('hello');
  expect(json.nodes[0]).toMatchObject({
    metadata: 'serialized',
    type: 'word',
    value: 'hello',
  });
  expect(json.inputs).toEqual([]);
  expect(json.nodes[0]).not.toHaveProperty('inputs');
  expect(hydrated).toBeInstanceOf(Container);
  expect(hydrated.type).toBe('custom-root');
  expect(hydrated.first?.type).toBe('word');
});

test('accepts custom stringifier functions and syntax objects', () => {
  const node = new Node({ type: 'word', value: 'hello' });
  const stringify = (current: Node, builder: (chunk: string) => void) => {
    builder(String((current as Node & { value: string }).value).toUpperCase());
  };

  expect(node.toString(stringify)).toBe('HELLO');
  expect(node.toString({ stringify })).toBe('HELLO');
});

test('deduplicates source inputs in JSON and restores them in fromJSON', () => {
  const input = {
    css: 'a{color:red;background:white}',
    from: 'input.css',
    toJSON() {
      return { css: this.css, from: this.from };
    },
  };
  const source = {
    start: { line: 1, column: 3, offset: 2 },
    end: { line: 1, column: 12, offset: 11 },
    input,
  };
  const root = new Root({
    nodes: [
      { prop: 'color', value: 'red', source },
      { prop: 'background', value: 'white', source },
    ],
  });

  const json = root.toJSON() as {
    inputs: unknown[];
    nodes: Array<{ source: { inputId: number } }>;
  };
  const hydrated = fromJSON(json) as Root;
  const ast = toAst(root);

  expect(json.inputs).toEqual([{ css: input.css, from: 'input.css' }]);
  expect(json.nodes.map((node) => node.source.inputId)).toEqual([0, 0]);
  expect(hydrated.first?.source?.input).toBe(hydrated.last?.source?.input);
  expect(ast.nodes[0].source?.file).toBe('input.css');
});

function twoRuleRoot(): Root {
  return new Root({
    nodes: [
      new Rule({ selector: 'a', nodes: [], raws: { before: '' } }),
      new Rule({ selector: 'b', nodes: [], raws: { before: '\n' } }),
    ],
  });
}

test('root children hand over raws.before when the first one is removed', () => {
  const removed = twoRuleRoot();
  const ignored = twoRuleRoot();

  removed.removeChild(0);
  ignored.removeChild(0, true);

  expect(removed.toString()).toBe('b {}');
  expect(ignored.toString()).toBe('\nb {}');
});

test('root prepend re-indents the displaced first child', () => {
  const root = twoRuleRoot();

  root.prepend(new Rule({ selector: 'z', nodes: [] }));

  expect(root.toString()).toBe('z {}\na {}\nb {}');
});

test('root insertion normalizes an explicit raws.before to its sibling', () => {
  const root = twoRuleRoot();

  root.append(new Rule({ selector: 'z', nodes: [], raws: { before: 'XX' } }));

  expect(root.last?.raws.before).toBe('\n');
});

test('hydration keeps serialized root raws instead of normalizing them', () => {
  const hydrated = fromJSON({
    type: 'root',
    nodes: [
      { type: 'rule', selector: 'a', nodes: [], raws: { before: '' } },
      { type: 'comment', text: 'note', raws: { before: '\n\n', left: ' ', right: ' ' } },
      { type: 'rule', selector: 'b', nodes: [], raws: { before: '\n' } },
    ],
  }) as Root;

  expect(hydrated.nodes.map((node) => node.raws.before)).toEqual(['', '\n\n', '\n']);
  expect(hydrated.toString()).toBe('a {}\n\n/* note */\nb {}');
});

test('JSON omits unset PostCSS keys while the bridge DTO keeps block', () => {
  const root = new Root({
    nodes: [
      { type: 'atrule', name: 'media', params: 'x', block: true, nodes: [] },
      { type: 'decl', prop: 'color', value: 'red' },
      { type: 'decl', prop: 'width', value: '1px', important: true },
    ],
  });
  const json = root.toJSON() as { nodes: Array<Record<string, unknown>> };
  const ast = toAst(root) as unknown as { nodes: Array<Record<string, unknown>> };

  expect(json.nodes[0]).not.toHaveProperty('block');
  expect(json.nodes[0]).toHaveProperty('nodes', []);
  expect(json.nodes[1]).not.toHaveProperty('important');
  expect(json.nodes[2]).toHaveProperty('important', true);
  expect(ast.nodes[0]).toMatchObject({ block: true, nodes: [] });
});

test('fromJSON restores the Input prototype for shared sources', () => {
  const serialized = { hasBOM: false, css: 'a {\n  color: red;\n}\n', file: '/tmp/in.css' };
  const hydrated = fromJSON({
    type: 'root',
    inputs: [serialized],
    nodes: [
      {
        type: 'rule',
        selector: 'a',
        nodes: [
          {
            type: 'decl',
            prop: 'color',
            value: 'red',
            source: {
              start: { line: 2, column: 3, offset: 6 },
              end: { line: 2, column: 13, offset: 16 },
              inputId: 0,
            },
          },
        ],
      },
    ],
  }) as Root;
  const input = (hydrated.first as Rule).first?.source?.input as unknown as Input;

  expect(input).toBeInstanceOf(Input);
  expect(input.from).toBe('/tmp/in.css');
  expect(input.fromOffset(6)).toEqual({ col: 3, line: 2 });
  expect(input.toJSON()).toEqual(serialized);
});

test('clones nested raws objects and rejects unsupported fromJSON payloads', () => {
  const root = new Root({
    nodes: [
      new Rule({
        selector: '.a',
        raws: {
          before: ' ',
          between: ' ',
          nested: { left: '  ', items: [{ mark: '*' }] },
        } as never,
        nodes: [new Declaration({ prop: 'color', value: 'red' })],
      }),
    ],
  });
  const clone = root.clone();
  expect((clone.first as Rule).raws).toMatchObject({
    nested: { left: '  ', items: [{ mark: '*' }] },
  });

  expect(fromJSON({ nodes: [] }).type).toBe('root');
  expect(() => fromJSON({} as never)).toThrow(/Unknown node type/);
});

test('shares the top-level JSON input table with nodes in custom properties', () => {
  const input = {
    css: 'a{color:red}',
    from: 'input.css',
    toJSON() {
      return { css: this.css, from: this.from };
    },
  };
  const root = new Root({
    nodes: [
      {
        prop: 'color',
        value: 'red',
        source: {
          start: { line: 1, column: 3, offset: 2 },
          end: { line: 1, column: 12, offset: 11 },
          input,
        },
      },
    ],
  }) as Root & { related?: Node };
  root.related = root.first;

  const json = root.toJSON() as {
    inputs: unknown[];
    related: { inputs?: unknown[]; source: { inputId: number } };
  };

  expect(json.inputs).toHaveLength(1);
  expect(json.related.inputs).toBeUndefined();
  expect(json.related.source.inputId).toBe(0);
});

test('raw() returns the raw object form and position helpers cover source-less nodes', () => {
  const decl = new Declaration({
    prop: 'color',
    value: 'red',
    raws: { between: { raw: ':  ', value: ':' } as never },
    source: { start: { line: 2, column: 3, offset: 4 } },
  });

  expect(decl.raw('between')).toBe(':  ');
  expect(decl.positionInside(2)).toEqual({ line: 2, column: 5, offset: 6 });
  expect(decl.positionBy({ word: 'red' })).toEqual({ line: 2, column: 3, offset: 4 });
  expect(decl.rangeBy({ word: 'red' })).toEqual({
    start: { line: 2, column: 3, offset: 4 },
    end: { line: 2, column: 6, offset: 7 },
  });

  const orphan = new Rule({ selector: 'a' });
  expect(orphan.rangeBy()).toEqual({
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 2, offset: 1 },
  });
  expect(orphan.rangeBy({ end: { line: 1, column: 1 }, start: { line: 1, column: 3 } })).toEqual({
    start: { line: 1, column: 3, offset: 0 },
    end: { line: 1, column: 4, offset: 1 },
  });
});

test('position helpers resolve offsets past the input and serialize source without an input', () => {
  const decl = new Declaration({
    prop: 'color',
    value: 'red',
    source: {
      start: { line: 9, column: 9 },
      end: { line: 9, column: 12 },
      input: { css: 'a{}' },
    },
  });

  // Line/column are past the short input, so sourceOffset clamps to input length.
  expect(decl.rangeBy({ start: { line: 9, column: 9 }, end: { line: 9, column: 12 } })).toEqual({
    start: { line: 9, column: 9, offset: 3 },
    end: { line: 9, column: 12, offset: 3 },
  });

  const rule = new Rule({
    selector: 'a',
    source: { start: { line: 1, column: 1, offset: 0 }, file: 'virtual.css' },
  });
  const json = rule.toJSON() as { source?: { file?: string; inputId?: number } };
  expect(json.source).toMatchObject({ file: 'virtual.css' });
  expect(json.source).not.toHaveProperty('inputId');
});

test('replaceWith flattens nested arrays and container proxies wrap walkers', () => {
  const root = new Root({
    nodes: [
      { type: 'comment', text: 'current' },
      { type: 'rule', selector: 'a', nodes: [] },
      { type: 'atrule', name: 'media', params: 'screen', nodes: [] },
    ],
  });
  const current = root.first as Comment;
  current.replaceWith([[{ text: 'nested' }]]);

  expect(root.nodes.map((node) => node.type)).toEqual(['comment', 'rule', 'atrule']);
  expect((root.first as Comment).text).toBe('nested');

  const proxy = root.toProxy();
  const walked: string[] = [];
  proxy.walk((node) => {
    walked.push(node.type);
    expect(node).toHaveProperty('proxyOf');
  });
  expect(walked).toEqual(['comment', 'rule', 'atrule']);
  expect(proxy.some((node) => node.type === 'rule')).toBe(true);
  expect(
    proxy.every(
      (node) => node.type === 'comment' || node.type === 'rule' || node.type === 'atrule',
    ),
  ).toBe(true);
  proxy.walkAtRules('media', (atRule) => {
    expect(atRule).toHaveProperty('proxyOf');
    expect(atRule.name).toBe('media');
  });
  proxy.walkRules('a', (rule) => {
    expect(rule).toHaveProperty('proxyOf');
    expect(rule.selector).toBe('a');
  });

  const ruleProxy = (root.nodes[1] as Rule).toProxy();
  ruleProxy.markClean();
  ruleProxy.selector = 'b';
  expect((root.nodes[1] as Rule).isClean).toBe(false);
  expect((root.nodes[1] as Rule).selector).toBe('b');

  const atRule = new AtRule({ name: 'media', params: 'screen', nodes: [] });
  const atProxy = atRule.toProxy();
  atProxy.markClean();
  atProxy.params = 'print';
  expect(atRule.isClean).toBe(false);

  const comment = new Comment({ text: 'note' });
  const commentProxy = comment.toProxy();
  commentProxy.markClean();
  commentProxy.text = 'updated';
  expect(comment.isClean).toBe(false);
  expect(comment.text).toBe('updated');

  const decl = new Declaration({ prop: 'color', value: 'red', important: false });
  const declProxy = decl.toProxy();
  declProxy.markClean();
  declProxy.important = true;
  expect(decl.isClean).toBe(false);
  expect(decl.important).toBe(true);
});

test('insertBefore and insertAfter reject nodes that are not children', () => {
  const root = new Root({ nodes: [{ type: 'rule', selector: 'a', nodes: [] }] });
  const foreign = new Rule({ selector: 'b', nodes: [] });

  expect(() => root.insertBefore(foreign, { text: 'x' })).toThrow(
    'Node is not a child of this container',
  );
  expect(() => root.insertAfter(foreign, { text: 'x' })).toThrow(
    'Node is not a child of this container',
  );
});

test('insertAfter moves proxied children instead of cloning them', () => {
  const root = new Root({
    nodes: [
      new Rule({
        selector: '.hero',
        nodes: [
          new Declaration({ prop: 'display', value: 'flex' }),
          new Rule({ selector: '& h1', nodes: [new Declaration({ prop: 'margin', value: '0' })] }),
          new Rule({
            selector: '& .cta',
            nodes: [new Declaration({ prop: 'border-radius', value: '999px' })],
          }),
        ],
      }),
    ],
  });
  const hero = root.first as Rule;
  const h1 = hero.nodes![1];
  const cta = hero.nodes![2];

  hero.after(h1.toProxy());
  expect(root.nodes![1]).toBe(h1);
  expect(root.nodes).toEqual([hero, h1]);
  expect(root.index(h1)).toBe(1);
  expect(hero.nodes).toHaveLength(2);

  h1.after(cta.toProxy());
  expect(root.nodes).toEqual([hero, h1, cta]);
  expect(root.index(cta)).toBe(2);
  expect(hero.nodes).toHaveLength(1);
});

test('moves children between roots while preserving ignored before raws', () => {
  const source = new Root({
    nodes: [
      new Rule({ selector: 'a', nodes: [], raws: { before: '' } }),
      new Rule({ selector: 'b', nodes: [], raws: { before: '\n' } }),
    ],
  });
  const target = new Root();
  const [first, second] = source.nodes;

  target.append(first, second);

  expect(source.nodes).toHaveLength(0);
  expect(target.nodes).toEqual([first, second]);
  expect(first.raws.before).toBe('');
});

test('insertBeforeIndex detaches nodes that still belong to another tree', () => {
  const source = new Root({
    nodes: [
      new Rule({ selector: 'a', nodes: [], raws: { before: '' } }),
      new Rule({ selector: 'b', nodes: [], raws: { before: '\n' } }),
    ],
  });
  const other = new Rule({
    selector: 'host',
    nodes: [new Declaration({ prop: 'color', value: 'red' })],
  });
  const target = new Root();
  const fromRoot = source.first as Rule;
  const fromRule = other.first as Declaration;

  target.insertBeforeIndex(0, [fromRoot, fromRule]);

  expect(source.nodes.map((node) => (node as Rule).selector)).toEqual(['b']);
  expect(other.nodes).toHaveLength(0);
  expect(target.nodes).toEqual([fromRoot, fromRule]);
});

test('stringify helpers cover raw value objects and comment spacing', () => {
  const withRawValue = new Declaration({
    prop: 'color',
    value: 'red',
    raws: { value: { value: 'red', raw: 'RED' } as never, between: ': ' },
  });
  expect(withRawValue.toString()).toBe('color: RED');

  const commentRoot = new Root();
  commentRoot.append(new Comment({ text: 'a', raws: { before: '\n  ' } }));
  const spaced = new Comment({ text: 'b' });
  commentRoot.append(spaced);
  delete spaced.raws.before;
  expect(defaultRaw(spaced, null as never, 'beforeComment')).toBe('\n');

  const plainCommentRoot = new Root();
  plainCommentRoot.append(new Comment({ text: 'a', raws: { before: '  ' } }));
  const plain = new Comment({ text: 'b' });
  plainCommentRoot.append(plain);
  delete plain.raws.before;
  expect(defaultRaw(plain, null as never, 'beforeComment')).toBe('  ');

  const closeRoot = new Root();
  closeRoot.append(
    new Rule({
      selector: 'a',
      nodes: [new Declaration({ prop: 'color', value: 'red' })],
      raws: { after: '  ', between: ' ' },
    }),
  );
  const needsClose = new Rule({
    selector: 'b',
    nodes: [new Declaration({ prop: 'color', value: 'blue' })],
    raws: { between: ' ' },
  });
  closeRoot.append(needsClose);
  delete needsClose.raws.before;
  expect(closeRoot.toString()).toContain('}');

  const indentRoot = new Root();
  indentRoot.append(
    new Rule({
      selector: 'a',
      raws: { before: '', between: ' ' },
      nodes: [
        new Rule({
          selector: 'b',
          raws: { before: '\n    ', between: ' ' },
          nodes: [],
        }),
      ],
    }),
  );
  const needsRuleBefore = new Rule({ selector: 'z', nodes: [] });
  indentRoot.append(needsRuleBefore);
  delete needsRuleBefore.raws.before;
  expect(defaultRaw(needsRuleBefore, null as never, 'beforeRule')).toBe('\n');
});

test('Node#raw infers colon, semicolon, indent, and empty-body raws from siblings', () => {
  const document = new Document();
  const nestedRoot = new Root();
  document.append(nestedRoot);
  expect(nestedRoot.raw('before')).toBe('');

  const colonRoot = new Root();
  const colonRule = new Rule({ selector: 'a' });
  colonRule.append(new Declaration({ prop: 'color', value: 'red', raws: { between: ':  ' } }));
  const inferredDecl = new Declaration({ prop: 'width', value: '1px' });
  colonRule.append(inferredDecl);
  colonRoot.append(colonRule);
  expect(inferredDecl.raw('between', 'colon')).toBe(':  ');

  const semicolonRoot = new Root();
  semicolonRoot.append(
    new Rule({
      selector: 'a',
      raws: { semicolon: true },
      nodes: [new Declaration({ prop: 'color', value: 'red' })],
    }),
  );
  const inferredRule = new Rule({
    selector: 'b',
    nodes: [new Declaration({ prop: 'display', value: 'block' })],
  });
  semicolonRoot.append(inferredRule);
  expect(inferredRule.raw('semicolon')).toBe(true);

  const emptyRoot = new Root();
  emptyRoot.append(new Rule({ selector: 'a', nodes: [], raws: { after: ' ' } }));
  const emptyRule = new Rule({ selector: 'b', nodes: [] });
  emptyRoot.append(emptyRule);
  expect(emptyRule.raw('after', 'emptyBody')).toBe(' ');

  const indentRoot = new Root();
  const outer = new Rule({ selector: 'a', nodes: [] });
  indentRoot.append(outer);
  outer.append(new Rule({ selector: 'b', nodes: [], raws: { before: '\n    ' } }));
  const indented = new Rule({ selector: 'c', nodes: [] });
  outer.append(indented);
  expect(indented.raw('indent')).toBe('    ');

  const closeRoot = new Root();
  const withClose = new Rule({
    selector: 'a',
    raws: { after: '\n  ' },
    nodes: [new Declaration({ prop: 'color', value: 'red' })],
  });
  closeRoot.append(withClose);
  const needsClose = new Rule({
    selector: 'b',
    nodes: [new Declaration({ prop: 'color', value: 'blue' })],
  });
  closeRoot.append(needsClose);
  expect(needsClose.raw('after', 'beforeClose')).toContain('\n');
});
