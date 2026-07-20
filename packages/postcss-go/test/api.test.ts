import { expect, test } from 'vitest';

import { parse, process as processCss } from '../src/index.ts';

test('parse and process reuse an explicit service without closing it', async () => {
  const calls = [];
  let closed = 0;
  const service = {
    async parse(css, options) {
      calls.push(['parse', css, options]);
      return { root: { type: 'root', nodes: [] } };
    },
    async process(css, options) {
      calls.push(['process', css, options]);
      return { css, root: { type: 'root', nodes: [] }, messages: [] };
    },
    async stringify() {
      return '';
    },
    async close() {
      closed += 1;
    },
  };

  await parse('a{}', { from: 'a.css' }, service);
  await processCss('b{}', { from: 'b.css' }, service);

  expect(calls).toEqual([
    ['parse', 'a{}', { from: 'a.css' }],
    ['process', 'b{}', { from: 'b.css' }],
  ]);
  expect(closed).toBe(0);
});
