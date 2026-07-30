import { expect, test } from 'vitest';

import { rawValue, restoreBridgeSources } from '../src/ast-utils.ts';
import type { AstNode } from '../src/types.ts';

const sourcePosition = { line: 1, column: 1, offset: 0 };

function rootWithInputId(inputId: number): AstNode {
  return {
    type: 'root',
    nodes: [],
    source: {
      inputId,
      start: sourcePosition,
      end: sourcePosition,
    },
  } as AstNode;
}

test('rawValue prefers matching raw forms and falls back otherwise', () => {
  expect(rawValue('plain', 'plain')).toBe('plain');
  expect(rawValue({ raw: 'a /**/ b', value: 'a b' }, 'a b')).toBe('a /**/ b');
  expect(rawValue({ raw: 'kept' }, 'fallback')).toBe('kept');
  expect(rawValue({ raw: 'ignored', value: 'other' }, 'fallback')).toBe('fallback');
  expect(rawValue(['not-raw'], 'fallback')).toBe('fallback');
  expect(rawValue(null, 'fallback')).toBe('fallback');
});

test('restoreBridgeSources rehydrates map text and toString() maps', () => {
  const withText = rootWithInputId(0);

  restoreBridgeSources(withText, [
    {
      css: '.a{}',
      file: 'a.css',
      map: { text: '{"version":3}', file: 'a.css.map' },
    },
  ]);

  expect(withText.source).toMatchObject({
    css: '.a{}',
    file: 'a.css',
    map: '{"version":3}',
    mapUrl: 'a.css.map',
  });

  const withToString = rootWithInputId(0);

  restoreBridgeSources(withToString, [
    {
      from: 'b.css',
      map: {
        toString() {
          return '{"version":3,"sources":[]}';
        },
      },
    },
  ]);

  expect(withToString.source).toMatchObject({
    file: 'b.css',
    map: '{"version":3,"sources":[]}',
    mapUrl: 'b.css',
  });
});
