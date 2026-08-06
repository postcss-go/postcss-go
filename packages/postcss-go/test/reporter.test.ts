import { expect, test } from 'vitest';

import { formatWarnings } from '../src/reporter.ts';

test('formatWarnings formats plain warning messages without a custom toString', () => {
  expect(
    formatWarnings({
      messages: [
        {
          type: 'warning',
          text: 'be careful',
          file: 'a.css',
          line: 1,
          column: 2,
          plugin: 'fixture',
        },
        { type: 'dependency', file: 'tokens.css' },
      ],
    }),
  ).toBe('a.css:1:2: fixture: be careful');
});

test('formatWarnings prefers an own toString implementation', () => {
  expect(
    formatWarnings({
      messages: [
        {
          type: 'warning',
          text: 'ignored',
          toString() {
            return 'custom warning';
          },
        },
      ],
    }),
  ).toBe('custom warning');
});

test('formatWarnings falls back when text and location are missing', () => {
  expect(
    formatWarnings({
      messages: [{ type: 'warning' }, { type: 'warning', text: 'only-text', plugin: 'p' }],
    }),
  ).toBe('Unknown warning\np: only-text');
});

test('formatWarnings keeps column 0 in the location prefix', () => {
  expect(
    formatWarnings({
      messages: [
        {
          type: 'warning',
          text: 'at-start',
          file: 'a.css',
          line: 1,
          column: 0,
          plugin: 'fixture',
        },
      ],
    }),
  ).toBe('a.css:1:0: fixture: at-start');
});
