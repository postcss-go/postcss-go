import { expect, test, vi } from 'vitest';

import { Document, Root } from '../src/ast.ts';
import {
  dispatchParse,
  dispatchParseSync,
  dispatchProcess,
  dispatchProcessDto,
  dispatchProcessSync,
  dispatchStringifySync,
} from '../src/dispatch.ts';
import type { ProcessResult } from '../src/types.ts';

function rootDto(): ProcessResult['root'] {
  return { type: 'root', nodes: [] };
}

test('dispatchStringifySync passes the live node to native-capable services', () => {
  const root = new Root();
  const stringifySync = vi.fn(() => '');

  dispatchStringifySync({ stringifySync }, root);

  expect(stringifySync).toHaveBeenCalledWith(root, { map: false });
});

test('dispatchProcess keeps an explicit processor on the Result', async () => {
  const processor = { plugins: [] };
  const service = {
    process: vi.fn(
      async (css: string): Promise<ProcessResult> => ({
        css,
        root: rootDto(),
        messages: [],
      }),
    ),
    parse: vi.fn(),
    stringify: vi.fn(),
    stringifyResult: vi.fn(),
    close: vi.fn(),
  };

  const result = await dispatchProcess(service, '.a{}', { from: 'a.css' }, [], processor);

  expect(result.processor).toBe(processor);
  expect(service.process).toHaveBeenCalledOnce();
});

test('dispatchProcess synthesizes a processor facade when none is provided', async () => {
  const service = {
    process: vi.fn(
      async (css: string): Promise<ProcessResult> => ({
        css,
        root: rootDto(),
        messages: [],
      }),
    ),
    parse: vi.fn(),
    stringify: vi.fn(),
    stringifyResult: vi.fn(),
    close: vi.fn(),
  };

  const result = await dispatchProcess(service, '.a{}', { from: 'a.css' });

  expect(result.processor).toEqual({ plugins: [] });
});

test('dispatchProcessSync hydrates a live root returned by the sync service', () => {
  const live = new Root();
  const processor = { plugins: [] };
  const service = {
    processSync: vi.fn(
      (css: string): ProcessResult => ({
        css,
        root: live,
        messages: [{ type: 'warning', text: 'sync', plugin: 'fixture' }],
      }),
    ),
    parseSync: vi.fn(),
    stringifySync: vi.fn(),
    stringifyResultSync: vi.fn(),
  };

  const result = dispatchProcessSync(service, '.a{}', { from: 'a.css' }, [], processor);

  expect(result.processor).toBe(processor);
  expect(result.root).toBe(live);
  expect(result.messages).toEqual([
    expect.objectContaining({ type: 'warning', text: 'sync', plugin: 'fixture' }),
  ]);
});

test('dispatchProcessSync synthesizes a processor facade when none is provided', () => {
  const service = {
    processSync: vi.fn(
      (css: string): ProcessResult => ({
        css,
        root: rootDto(),
        messages: [],
      }),
    ),
    parseSync: vi.fn(),
    stringifySync: vi.fn(),
    stringifyResultSync: vi.fn(),
  };

  const result = dispatchProcessSync(service, '.a{}', { from: 'a.css' });

  expect(result.processor).toEqual({ plugins: [] });
  expect(result.root).toBeInstanceOf(Root);
});

test('dispatchProcessDto reuses a live Node root from the service', async () => {
  const live = new Root();
  const service = {
    process: vi.fn(
      async (css: string): Promise<ProcessResult> => ({
        css,
        root: live,
        messages: [],
      }),
    ),
  };

  const result = await dispatchProcessDto(service, '.a{}', { from: 'a.css' });

  expect(result.root).toBe(live);
  expect(result.root).toBeInstanceOf(Root);
});

test('dispatchParse rejects Document responses that are not Root', async () => {
  const service = {
    parse: vi.fn(async () => ({ root: { type: 'document' as const, nodes: [] } })),
  };

  await expect(dispatchParse(service, '.a{}')).rejects.toThrow(
    /postcss-go parse response is not a root/,
  );
});

test('dispatchParseSync rejects live Document roots', () => {
  const service = {
    parseSync: vi.fn(() => ({ root: new Document() })),
  };

  expect(() => dispatchParseSync(service, '.a{}')).toThrow(
    /postcss-go parseSync response is not a root/,
  );
});
