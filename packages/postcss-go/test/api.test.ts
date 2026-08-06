import { expect, test } from 'vitest';

import {
  parse,
  process as processCss,
  Warning,
  WASM_WORKER_BACKEND_CAPABILITIES,
} from '../src/index.ts';

test('parse and process reuse an explicit service without closing it', async () => {
  const calls = [];
  let closed = 0;
  const service = {
    capabilities: WASM_WORKER_BACKEND_CAPABILITIES,
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

test('standalone process hydrates backend warnings', async () => {
  const service = {
    capabilities: WASM_WORKER_BACKEND_CAPABILITIES,
    async process(css: string) {
      return {
        css,
        root: { type: 'root' as const, nodes: [] },
        messages: [{ type: 'warning', text: 'check', plugin: 'fixture' }],
      };
    },
    async close() {},
  };

  const result = await processCss('a{}', {}, service as never);
  expect(result.messages[0]).toBeInstanceOf(Warning);
  expect(result.messages[0].toString()).toBe('fixture: check');
  expect(result.backend).toBe('wasm-worker');
});
