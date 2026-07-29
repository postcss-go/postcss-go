import { expect, test } from 'vitest';

import {
  CssSyntaxError,
  Input,
  Result,
  Root,
  Warning,
  postcss,
  stringifySync,
} from '../src/index.ts';
import { parseOwnedSync } from '../src/parser.ts';

test('owned parser and stringifier handle nested CSS without PostCSS constructors', () => {
  const css = '@media screen { .a { color: red; --value: fn(a; b) } }';
  const root = parseOwnedSync(css, { from: 'input.css' });

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
