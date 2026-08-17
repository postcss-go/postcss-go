import { expect, test } from 'vitest';

import {
  Document,
  noWork,
  noWorkSync,
  parse,
  parseSync,
  process,
  processSync,
  Processor,
  stringify,
  stringifySync,
} from '../src/index.ts';
import {
  coreCssContract,
  coreCssMapOptions,
  coreCssPreviousMapOptions,
  expectCoreCssPreviousMap,
  expectCoreCssSourceMap,
  normalizeContractAst,
  stripSourceMapAnnotation,
} from './helpers/core-css-contract.ts';

test('public Node parse / process / stringify / noWork follow the Core CSS contract', async () => {
  for (const scenario of coreCssContract.roundTrips) {
    const root = await parse(scenario.css, { from: coreCssContract.from });
    expect(normalizeContractAst(root), scenario.name).toEqual(scenario.ast);
    expect(await stringify(root, { map: false }), scenario.name).toBe(scenario.css);
  }

  {
    const css = coreCssContract.css;

    const processed = await process(css, {
      from: coreCssContract.from,
      to: coreCssContract.to,
      map: coreCssMapOptions,
    });
    expect(processed.css).toBe(css);
    expectCoreCssSourceMap(processed.map);

    const withPrev = await process(css, {
      from: coreCssContract.from,
      to: coreCssContract.to,
      map: coreCssPreviousMapOptions,
    });
    expect(withPrev.css).toBe(css);
    expectCoreCssPreviousMap(withPrev.map);

    const processorResult = await new Processor().process(css, {
      from: coreCssContract.from,
      to: coreCssContract.to,
      map: coreCssMapOptions,
    });
    expect(processorResult.css).toBe(css);
    expectCoreCssSourceMap(processorResult.map);

    expect((await noWork(css, { map: false })).css).toBe(css);
    const staleAnnotation = `${css}/*# sourceMappingURL=stale.css.map */\n`;
    expect(stripSourceMapAnnotation((await noWork(staleAnnotation, { map: false })).css)).toBe(
      coreCssContract.noWorkCleanCss,
    );

    const inline = await process(css, {
      from: coreCssContract.from,
      to: coreCssContract.to,
      map: { inline: true },
    });
    expect(inline.css).toContain('sourceMappingURL=data:application/json;base64,');

    const first = await parse('a { color: red; }\n', { from: 'contract/a.css' });
    const second = await parse('b { color: blue; }\n', { from: 'contract/b.css' });
    const document = new Document({ nodes: [first, second] });
    expect(await stringify(document, { map: false })).toBe(coreCssContract.documentCss);

    const mutated = await new Processor([
      {
        postcssPlugin: 'core-contract-mutation',
        Declaration(decl) {
          if (decl.prop === 'color') decl.value = 'teal';
        },
      },
    ]).process(coreCssContract.mutation.css, { from: coreCssContract.from, map: false });
    expect(mutated.css).toBe(coreCssContract.mutation.expectedCss);
  }

  for (const error of coreCssContract.errors) {
    await expect(
      process(error.css, { from: coreCssContract.from }),
      error.name,
    ).rejects.toMatchObject({
      name: 'CssSyntaxError',
      line: error.line,
      column: error.column,
      reason: error.reason,
    });
  }
});

test('public Node sync APIs follow the Core CSS contract', () => {
  for (const scenario of coreCssContract.roundTrips) {
    const root = parseSync(scenario.css, { from: coreCssContract.from });
    expect(normalizeContractAst(root), scenario.name).toEqual(scenario.ast);
    expect(stringifySync(root, { map: false }), scenario.name).toBe(scenario.css);
  }

  {
    const css = coreCssContract.css;

    const processed = processSync(css, {
      from: coreCssContract.from,
      to: coreCssContract.to,
      map: coreCssMapOptions,
    });
    expect(processed.css).toBe(css);
    expectCoreCssSourceMap(processed.map);

    const withPrev = processSync(css, {
      from: coreCssContract.from,
      to: coreCssContract.to,
      map: coreCssPreviousMapOptions,
    });
    expect(withPrev.css).toBe(css);
    expectCoreCssPreviousMap(withPrev.map);

    expect(noWorkSync(css, { map: false }).css).toBe(css);

    const mutated = processSync(
      coreCssContract.mutation.css,
      { from: coreCssContract.from, map: false },
      [
        {
          postcssPlugin: 'core-contract-sync-mutation',
          Declaration(decl) {
            if (decl.prop === 'color') decl.value = 'teal';
          },
        },
      ],
    );
    expect(mutated.css).toBe(coreCssContract.mutation.expectedCss);
  }

  for (const error of coreCssContract.errors) {
    expect(() => processSync(error.css, { from: coreCssContract.from }), error.name).toThrow(
      expect.objectContaining({
        name: 'CssSyntaxError',
        line: error.line,
        column: error.column,
        reason: error.reason,
      }),
    );
  }
});
