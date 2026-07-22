import { expect, test } from 'vitest';

import { Comment, Declaration, Document, Root, Rule, fromAst, toAst } from '../src/index.ts';

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
  expect(toAst(document)).toEqual(dto);
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

test('toResult stringifies a Document and keeps its Document root', async () => {
  const document = new Document();
  document.append(new Root({ nodes: [{ type: 'rule', selector: 'a', nodes: [] }] }));
  let closed = 0;
  const service = {
    async parse() {
      throw new Error('parse should not be called');
    },
    async process(css: string) {
      return {
        css: `${css}\n/* mapped */`,
        map: '{}',
        root: { type: 'root', nodes: [] },
        messages: [],
      };
    },
    async stringify() {
      return 'a {}';
    },
    async close() {
      closed += 1;
    },
  };

  const result = await document.toResult({}, service);

  expect(result.css).toBe('a {}');
  expect(result.root.type).toBe('document');
  expect(result.messages).toEqual([]);
  expect(closed).toBe(0);
});

test('toResult delegates source-map generation to process', async () => {
  const document = new Document();
  document.append(new Root({ nodes: [{ type: 'rule', selector: 'a', nodes: [] }] }));
  let processed = false;
  const service = {
    async parse() {
      throw new Error('parse should not be called');
    },
    async process(css: string, options: { map?: boolean }) {
      processed = options.map === true;
      return { css, map: 'map', root: { type: 'root', nodes: [] }, messages: [] };
    },
    async stringify() {
      return 'a {}';
    },
    async close() {},
  };

  const result = await document.toResult({ map: true }, service);

  expect(processed).toBe(true);
  expect(result.map).toBe('map');
  expect(result.root.type).toBe('document');
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
  expect(rule.toString()).toBe('.a {color: red;}');
  expect(String(root)).toBe('.a {color: red;}');
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
