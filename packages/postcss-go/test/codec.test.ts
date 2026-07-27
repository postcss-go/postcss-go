import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { Root } from '../src/ast.ts';
import { decodeAst, encodeAst, hydrateAst, serializeAst } from '../src/codec.ts';
import { createNativeService, isNativeBridgeAvailable } from '../src/native.ts';

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
});
