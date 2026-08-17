import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { Node, Root, Document } from '../src/ast.ts';
import { assertSupportedAst } from '../src/ast-utils.ts';
import { decodeAst, encodeAst, hydrateAst, serializeAst } from '../src/codec.ts';
import { UnsupportedAstNodeError } from '../src/errors.ts';
import {
  createNativeService,
  isNativeAsyncBridgeAvailable,
  isNativeBridgeAvailable,
} from '../src/native.ts';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(
  resolve(here, '../../../benchmark/fixtures/css/modern-normalize.css'),
  'utf8',
);

describe('binary codec + native bridge', () => {
  it.skipIf(!isNativeBridgeAvailable())(
    'parses and stringifies through the native binary path',
    async () => {
      const service = createNativeService();
      const parsed = service.parseSync(css, { from: 'modern-normalize.css' });
      expect(parsed.root).toBeInstanceOf(Root);
      expect(parsed.root.nodes?.length).toBeGreaterThan(0);

      const roundTrip = serializeAst(parsed.root);
      expect(hydrateAst(roundTrip)).toBeInstanceOf(Root);

      const stringified = service.stringifyResultSync(parsed.root);
      expect(stringified.css).toContain('html');
      await service.close();
    },
  );

  it.skipIf(!isNativeBridgeAvailable())(
    'returns a live root from the framed synchronous process operation',
    async () => {
      const service = createNativeService();
      const rules = 50_000;
      const largeCss = Array.from(
        { length: rules },
        (_, index) => `.rule-${index}{z-index:${index}}`,
      ).join('');

      const processed = service.processSync(largeCss, { from: 'large.css' });
      expect(processed.css).toBe(largeCss);
      expect(processed.root).toBeInstanceOf(Root);
      expect(processed.root.nodes).toHaveLength(rules);
      await service.close();
    },
  );

  it.skipIf(!isNativeAsyncBridgeAvailable())(
    'runs every Promise operation through the native async-work surface',
    async () => {
      const service = createNativeService();
      const parsed = await service.parse(css, { from: 'modern-normalize.css' });
      const [processed, noWork, stringified] = await Promise.all([
        service.process('.a{}', { from: 'input.css' }),
        service.noWork('.b{}', { from: 'input.css' }),
        service.stringifyResult(parsed.root),
      ]);

      expect(processed.css).toBe('.a{}');
      expect(noWork.css).toBe('.b{}');
      expect(stringified.css).toContain('html');
      await service.close();
    },
  );

  it.skipIf(!isNativeAsyncBridgeAvailable())(
    'does not settle a CPU-heavy native parse before the event loop advances',
    async () => {
      const service = createNativeService();
      const largeCss = Array.from(
        { length: 100_000 },
        (_, index) => `.rule-${index}{color:red}`,
      ).join('');
      let settled = false;
      const parsing = service.parse(largeCss).finally(() => {
        settled = true;
      });

      await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
      expect(settled).toBe(false);
      await expect(parsing).resolves.toMatchObject({ root: { type: 'root' } });
      await service.close();
    },
  );

  it.skipIf(!isNativeAsyncBridgeAvailable())(
    'keeps concurrent native operation results isolated',
    async () => {
      const service = createNativeService();
      const results = await Promise.all(
        Array.from({ length: 16 }, (_, index) =>
          service.process(`.rule-${index}{z-index:${index}}`, {
            from: `input-${index}.css`,
          }),
        ),
      );

      for (let index = 0; index < results.length; index++) {
        expect(results[index].css).toBe(`.rule-${index}{z-index:${index}}`);
      }
      await service.close();
    },
  );

  it('round-trips a minimal AstDTO through encode/decode', () => {
    const dto = {
      type: 'root' as const,
      nodes: [
        {
          type: 'rule' as const,
          selector: '.a',
          nodes: [
            {
              type: 'decl' as const,
              prop: 'color',
              value: 'red',
              important: true,
              raws: { before: ' ', between: ': ' },
            },
          ],
          raws: { between: ' ', after: ' ', semicolon: true },
        },
        {
          type: 'atrule' as const,
          name: 'media',
          params: 'screen',
          block: true,
          nodes: [],
        },
        {
          type: 'atrule' as const,
          name: 'import',
          params: '"x.css"',
        },
      ],
      raws: { after: '' },
    };
    const encoded = encodeAst(dto);
    expect(encoded.subarray(0, 4).toString('utf8')).toBe('PCGW');
    expect(decodeAst(encoded)).toEqual(dto);

    const live = hydrateAst(encoded);
    expect(live).toBeInstanceOf(Root);
    expect(live.nodes).toHaveLength(3);
    expect(serializeAst(live).equals(encoded)).toBe(true);
  });

  it('preserves previous-map metadata from a PostCSS input across the binary boundary', () => {
    const previousMap = JSON.stringify({
      version: 3,
      sources: ['original.css'],
      names: [],
      mappings: 'AAAA',
    });
    const dto = {
      type: 'root' as const,
      nodes: [],
      source: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 1, offset: 0 },
        input: {
          css: '.a{}',
          from: 'generated.css',
          map: {
            file: 'generated.css.map',
            text: previousMap,
          },
        },
      },
    };

    expect(decodeAst(encodeAst(dto as never))).toMatchObject({
      source: {
        file: 'generated.css',
        css: '.a{}',
        map: previousMap,
        mapUrl: 'generated.css.map',
      },
    });
  });

  it('rejects custom AST nodes before they cross a backend boundary', () => {
    const custom = new Node({ type: 'word' });

    expect(() => assertSupportedAst(custom)).toThrow(UnsupportedAstNodeError);
    expect(() => serializeAst(custom)).toThrow(UnsupportedAstNodeError);
    expect(() => encodeAst({ type: 'word' } as never)).toThrow(UnsupportedAstNodeError);
  });

  it('round-trips documents, comments, floats, and rich raw values', () => {
    const dto = {
      type: 'document' as const,
      nodes: [
        {
          type: 'root' as const,
          nodes: [
            {
              type: 'comment' as const,
              text: 'hi',
              raws: {
                before: null,
                flag: true,
                ratio: 1.5,
                list: ['a', { nested: 2 }],
                pair: { raw: '/*', value: 'hi' },
                map: { k: 'v' },
              },
            },
          ],
        },
      ],
    };

    const encoded = encodeAst(dto as never);
    const decoded = decodeAst(encoded);
    expect(decoded).toMatchObject({
      type: 'document',
      nodes: [
        {
          type: 'root',
          nodes: [
            {
              type: 'comment',
              text: 'hi',
              raws: {
                flag: true,
                ratio: 1.5,
                list: ['a', { nested: 2 }],
                pair: { raw: '/*', value: 'hi' },
                map: { k: 'v' },
              },
            },
          ],
        },
      ],
    });
    expect(
      (decoded as { nodes: Array<{ nodes: Array<{ raws: Record<string, unknown> }> }> }).nodes[0]
        .nodes[0].raws,
    ).not.toHaveProperty('before');

    const live = new Document({
      nodes: [new Root({ nodes: [] })],
    });
    const liveEncoded = serializeAst(live);
    expect(decodeAst(liveEncoded).type).toBe('document');
    expect(() => hydrateAst(liveEncoded)).toThrow(/expected a root/);
  });

  it('serializes incomplete source records so Node#toString can reach Go', () => {
    const live = new Root({
      nodes: [],
      source: {
        start: { line: 1, column: 1, offset: 0 },
        input: { css: '.a{}', from: 'partial.css' },
      } as never,
    });

    expect(decodeAst(serializeAst(live))).toMatchObject({
      source: {
        file: 'partial.css',
        css: '.a{}',
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 1, offset: 0 },
      },
    });
  });

  it('rejects malformed buffers and unsupported raw values', () => {
    expect(() => decodeAst(Buffer.from('XXXX\x01'))).toThrow(/bad magic or version/);
    expect(() => decodeAst(Buffer.from([0x50, 0x43, 0x47, 0x57, 0x01, 0xff]))).toThrow(
      /unknown node tag/,
    );
    expect(() =>
      encodeAst({
        type: 'root',
        nodes: [],
        raws: { bad: Symbol('x') as never },
      } as never),
    ).toThrow(/unsupported raw value/);
  });

  it('encodes source maps from input.map.toString and walks nested unsupported nodes', () => {
    const nested = {
      type: 'root' as const,
      nodes: [{ type: 'word', value: 'x' }],
    };
    expect(() => assertSupportedAst(nested as never)).toThrow(UnsupportedAstNodeError);

    const encoded = encodeAst({
      type: 'root',
      nodes: [],
      source: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 1, offset: 0 },
        input: {
          css: '.a{}',
          from: 'a.css',
          map: {
            file: 'a.css.map',
            toString() {
              return JSON.stringify({
                version: 3,
                sources: ['a.css'],
                mappings: 'AAAA',
                names: [],
              });
            },
          },
        },
      },
    } as never);
    expect(decodeAst(encoded)).toMatchObject({
      source: {
        file: 'a.css',
        mapUrl: 'a.css.map',
      },
    });
  });

  it('uses bigint encoding paths for large integer raw values', () => {
    // Zigzag of this negative exceeds MAX_SAFE_INTEGER and takes the bigint write path.
    const encoded = encodeAst({
      type: 'root',
      nodes: [],
      raws: { neg: -4_503_599_627_370_497 },
    } as never);
    expect(encoded.length).toBeGreaterThan(8);

    const floatEncoded = encodeAst({
      type: 'root',
      nodes: [],
      raws: { ratio: Math.PI },
    } as never);
    expect((decodeAst(floatEncoded) as { raws?: { ratio?: number } }).raws?.ratio).toBeCloseTo(
      Math.PI,
    );
  });

  it('round-trips non-block atrules and rejects non-block atrules with children', () => {
    const encoded = encodeAst({
      type: 'root',
      nodes: [{ type: 'atrule', name: 'import', params: '"x.css"' }],
    } as never);
    expect(decodeAst(encoded)).toMatchObject({
      nodes: [{ type: 'atrule', name: 'import', params: '"x.css"' }],
    });
    expect(hydrateAst(encoded)).toBeInstanceOf(Root);

    const writerParts = encodeAst({
      type: 'root',
      nodes: [{ type: 'atrule', name: 'charset', params: '"utf-8"' }],
    } as never);
    // Force a non-block atrule child count of 1 by flipping the trailing zero
    // count byte after a successful encode of an empty non-block atrule.
    const broken = Buffer.from(writerParts);
    broken[broken.length - 1] = 1;
    expect(() => decodeAst(broken)).toThrow(/non-block atrule has children/);
    expect(() => hydrateAst(broken)).toThrow(/non-block atrule has children/);
  });
});
