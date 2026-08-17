import { expect, test } from 'vitest';

import {
  CssSyntaxError,
  Input,
  Result,
  Root,
  Warning,
  parseSync,
  postcss,
  stringifySync,
} from '../src/index.ts';

test('owned parser and stringifier handle nested CSS without PostCSS constructors', () => {
  const css = '@media screen { .a { color: red; --value: fn(a; b) } }';
  const root = parseSync(css, { from: 'input.css' });

  expect(root).toBeInstanceOf(Root);
  expect(root.toString()).toBe(css);
  expect(root.first?.source?.input).toBeInstanceOf(Input);

  let built = '';
  stringifySync(root, (chunk) => {
    built += chunk;
  });
  expect(built).toBe(css);
});

test('plugin helpers expose owned result, warning, input, and error classes', () => {
  expect(postcss.Result).toBe(Result);
  expect(postcss.Warning).toBe(Warning);
  expect(postcss.Input).toBe(Input);
  expect(postcss.CssSyntaxError).toBe(CssSyntaxError);

  expect(() => postcss.parse('a { color: red')).toThrow(CssSyntaxError);
  const error = new Input('a\nbroken').error('broken', 2, 3);
  expect(error).toMatchObject({ name: 'CssSyntaxError', line: 2, column: 3 });
});

test('owned parser accepts comments, at-rules, important flags, and quoted values', () => {
  const root = parseSync(
    '/* leading */\n@import "x.css";\n.a { color: red !important; content: "a:b"; background: url(a:b) }\n',
    { from: 'input.css' },
  );

  expect(root.toString()).toContain('leading');
  expect(root.toString()).toContain('@import');
  expect(root.toString()).toContain('!important');
  expect(root.toString()).toContain('"a:b"');
  expect(parseSync('.a { ; color: blue }').toString()).toContain('blue');
  expect(parseSync('.a { content: "\\""; prop: val\\:ue }').toString()).toContain('content');
});

test('owned parser reports unclosed comments and unexpected braces', () => {
  expect(() => parseSync('/* unclosed')).toThrow(/Unclosed comment/);
  expect(() => parseSync('.a { color: "unterminated')).toThrow();
  expect(() => parseSync('}')).toThrow(/Unexpected }/);
});
