import {
  BrowserPostcssGoService,
  CssSyntaxError,
  createBrowserProcessor,
  WasmWorkerError,
} from 'postcss-go/wasm';
import wasmUrl from 'postcss-go/wasm/postcss-go.wasm?url';
import wasmExecUrl from 'postcss-go/wasm/wasm_exec.js?url';
import workerUrl from 'postcss-go/wasm/worker?url';
import { SourceMapConsumer } from 'source-map-js';

import contract from '../testdata/core-css-contract.json';

function normalizeAst(node: Record<string, unknown>): unknown {
  const normalized: Record<string, unknown> = { type: node.type };
  if (node.type === 'rule') {
    normalized.selector = node.selector;
  } else if (node.type === 'atrule') {
    normalized.name = node.name;
    normalized.params = node.params;
  } else if (node.type === 'decl') {
    normalized.prop = node.prop;
    normalized.value = node.value;
  } else if (node.type === 'comment') {
    normalized.text = node.text;
  }
  const source = node.source as
    | { start?: { line?: number; column?: number }; end?: { line?: number; column?: number } }
    | undefined;
  if (source?.start && source.end) {
    normalized.source = {
      start: [source.start.line, source.start.column],
      end: [source.end.line, source.end.column],
    };
  }
  if (Array.isArray(node.nodes)) {
    normalized.nodes = node.nodes.map((child) => normalizeAst(child as Record<string, unknown>));
  }
  return normalized;
}

declare global {
  var __postcssGoWasmSmoke:
    | { status: 'pending' }
    | { status: 'passed'; mapFile?: string }
    | { status: 'failed'; name: string; message: string; stack?: string };
}

globalThis.__postcssGoWasmSmoke = { status: 'pending' };

void (async () => {
  const service = new BrowserPostcssGoService({
    workerUrl,
    wasmUrl,
    wasmExecUrl,
    requestTimeoutMs: 15_000,
  });
  try {
    for (const scenario of contract.roundTrips) {
      const parsed = await service.parse(scenario.css, { from: contract.from });
      if (
        JSON.stringify(normalizeAst(parsed.root as unknown as Record<string, unknown>)) !==
        JSON.stringify(scenario.ast)
      ) {
        throw new Error(`${scenario.name}: browser Worker AST diverged`);
      }
      const stringified = await service.stringifyResult(parsed.root, { map: false });
      if (stringified.css !== scenario.css) {
        throw new Error(`${scenario.name}: browser Worker round-trip diverged`);
      }
    }

    const parsed = await service.parse(contract.css, { from: contract.from });
    if (!parsed.root.source?.file?.endsWith(contract.from)) {
      throw new Error(`relative source path was not preserved: ${parsed.root.source?.file}`);
    }

    const processed = await service.process(contract.css, {
      from: contract.from,
      to: contract.to,
      map: { inline: false, annotation: false },
    });
    if (processed.css !== contract.css) throw new Error('browser Worker process changed CSS');
    if (processed.mapFile !== `${contract.to}.map`) {
      throw new Error(`unexpected mapFile: ${processed.mapFile}`);
    }
    if (!processed.map) throw new Error('external source map was not returned');
    const map = JSON.parse(String(processed.map));
    if (map.file !== 'output.css' || !map.sourcesContent?.includes(contract.css)) {
      throw new Error(`unexpected browser Worker source map: ${JSON.stringify(map)}`);
    }
    const consumer = new SourceMapConsumer(map);
    for (const check of contract.mapChecks) {
      const original = consumer.originalPositionFor({
        line: check.generated[0],
        column: check.generated[1],
      });
      if (original.line !== check.original[0] || original.column !== check.original[1]) {
        throw new Error(
          `browser Worker mapping ${check.generated.join(':')} resolved to ${original.line}:${original.column}`,
        );
      }
    }

    const composed = await service.process(contract.css, {
      from: contract.from,
      to: contract.to,
      map: { prev: contract.previousMap, inline: false, annotation: false },
    });
    if (!JSON.parse(String(composed.map)).sources?.includes(contract.previousSource)) {
      throw new Error('browser Worker did not compose the shared previous map');
    }

    const inline = await service.process(contract.css, {
      from: contract.from,
      to: contract.to,
      map: { inline: true },
    });
    if (!inline.css.includes('sourceMappingURL=data:application/json;base64,')) {
      throw new Error('browser Worker inline source-map annotation is missing');
    }

    const roots = await Promise.all([
      service.parse('a { color: red; }\n', { from: 'contract/a.css' }),
      service.parse('b { color: blue; }\n', { from: 'contract/b.css' }),
    ]);
    const document = await service.stringifyResult(
      { type: 'document', raws: {}, nodes: roots.map((entry) => entry.root) } as never,
      { map: false },
    );
    if (document.css !== contract.documentCss) {
      throw new Error(`browser Worker Document mismatch: ${JSON.stringify(document.css)}`);
    }

    const stale = `${contract.css}/*# sourceMappingURL=stale.css.map */\n`;
    if ((await service.noWork(stale, { map: false })).css !== contract.noWorkCleanCss) {
      throw new Error('browser Worker noWork annotation cleanup diverged');
    }

    for (const expected of contract.errors) {
      try {
        await service.process(expected.css, { from: contract.from });
        throw new Error(`${expected.name}: invalid CSS was accepted`);
      } catch (error) {
        if (
          !(error instanceof CssSyntaxError) ||
          error.line !== expected.line ||
          error.column !== expected.column ||
          error.reason !== expected.reason
        ) {
          throw error;
        }
      }
    }

    const processor = createBrowserProcessor(
      [
        {
          postcssPlugin: 'browser-core-contract-mutation',
          Declaration(decl) {
            if (decl.prop === 'color') decl.value = 'teal';
          },
        },
      ],
      { workerUrl, wasmUrl, wasmExecUrl, requestTimeoutMs: 15_000 },
    );
    const mutated = await processor.process(contract.mutation.css, { from: contract.from });
    await processor.close();
    if (mutated.css !== contract.mutation.expectedCss) {
      throw new Error(`browser Worker mutation mismatch: ${JSON.stringify(mutated.css)}`);
    }

    await service.close();
    try {
      await service.parse('.closed {}');
      throw new Error('closed service unexpectedly accepted a request');
    } catch (error) {
      if (!(error instanceof WasmWorkerError)) throw error;
    }

    globalThis.__postcssGoWasmSmoke = { status: 'passed', mapFile: processed.mapFile };
  } catch (error) {
    await service.close();
    const failure = error instanceof Error ? error : new Error(String(error));
    globalThis.__postcssGoWasmSmoke = {
      status: 'failed',
      name: failure.name,
      message: failure.message,
      stack: failure.stack,
    };
  }
})();
