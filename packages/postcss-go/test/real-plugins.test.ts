import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import upstream from 'postcss';
import atImport from 'postcss-import';
import nested from 'postcss-nested';
import { afterAll, expect, test } from 'vitest';

import { Processor } from '../src/processor.ts';
import { createNativeService } from '../src/native.ts';
import { createBrowserProcessor } from '../src/wasm/browser.ts';
import type { AcceptedPlugin } from '../src/plugin-types.ts';
import { RealWasmWorker } from './helpers/real-wasm-worker.ts';
import {
  asyncColorPlugin,
  nestedMutationCss,
  nestedMutationPlugin,
} from './helpers/plugin-contract.ts';

const fixtureRoot = mkdtempSync(join(tmpdir(), 'postcss-go-real-plugins-'));
const inputFile = join(fixtureRoot, 'input.css');
const partialFile = join(fixtureRoot, 'partial.css');

mkdirSync(fixtureRoot, { recursive: true });
writeFileSync(partialFile, '.imported { color: green; }\n');
writeFileSync(inputFile, '@import "./partial.css";\n.local { display: block; }\n');

const native = createNativeService();

afterAll(async () => {
  await native.close();
});

test('postcss-import inlines files and emits dependency messages on native and upstream PostCSS', async () => {
  const css = '@import "./partial.css";\n.local { display: block; }\n';
  const plugin = atImport({ root: fixtureRoot }) as AcceptedPlugin;

  const owned = await new Processor([plugin]).process(
    css,
    { from: inputFile, map: false },
    { service: native },
  );
  const reference = await upstream([plugin]).process(css, { from: inputFile, map: false });

  expect(owned.css).toContain('.imported { color: green; }');
  expect(owned.css).toContain('.local { display: block; }');
  expect(owned.css).toBe(reference.css);
  expect(owned.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'dependency',
        plugin: 'postcss-import',
      }),
    ]),
  );
  const imported = owned.messages.find((message) => message.type === 'dependency') as {
    file?: string;
    parent?: string;
  };
  expect(imported.file && realpathSync(imported.file)).toBe(realpathSync(partialFile));
  expect(imported.parent && realpathSync(imported.parent)).toBe(realpathSync(inputFile));
  expect(
    reference.messages.some((message) => {
      const file = (message as { file?: string }).file;
      return (
        message.type === 'dependency' &&
        file !== undefined &&
        realpathSync(file) === realpathSync(partialFile)
      );
    }),
  ).toBe(true);
});

test('mutation-heavy and asynchronous plugins match across native and WASM Worker', async () => {
  const wasm = createBrowserProcessor([nestedMutationPlugin, asyncColorPlugin], {
    worker: new RealWasmWorker(),
  });
  try {
    const nativeResult = await new Processor([nestedMutationPlugin, asyncColorPlugin]).process(
      nestedMutationCss,
      { from: 'real.css', map: false },
      { service: native },
    );
    const wasmResult = await wasm.process(nestedMutationCss, { from: 'real.css', map: false });
    expect(wasmResult.css).toBe(nativeResult.css);
    expect(nativeResult.css).toContain('.card .title');
    expect(nativeResult.css).toContain('navy');
  } finally {
    await wasm.close();
  }
});

const multipleAmpersandCss = `.hero {
  display: flex;

  & h1 {
    margin: 0;
  }

  & .cta {
    border-radius: 999px;
  }
}`;

test('postcss-nested flattens multiple & blocks in one rule', async () => {
  const plugin = nested() as AcceptedPlugin;
  const owned = await new Processor([plugin]).process(multipleAmpersandCss, {
    from: 'input.css',
    map: false,
  });
  const reference = await upstream([plugin]).process(multipleAmpersandCss, {
    from: 'input.css',
    map: false,
  });

  expect(owned.css).toBe(reference.css);
  expect(owned.css).toContain('.hero h1');
  expect(owned.css).toContain('.hero .cta');
});
