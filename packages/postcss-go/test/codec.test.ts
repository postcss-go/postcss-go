import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { Node, Root } from '../src/ast.ts';
import {
  assertSupportedAst,
  decodeAst,
  encodeAst,
  hydrateAst,
  serializeAst,
} from '../src/codec.ts';
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
});
