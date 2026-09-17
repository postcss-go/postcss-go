import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { Processor } from '../packages/postcss-go/dist/index.js';

const require = createRequire(new URL('../packages/postcss-go/package.json', import.meta.url));
const manifest = JSON.parse(
  readFileSync(new URL('../packages/postcss-go/test/fixtures/native-corpus.json', import.meta.url)),
);
assert.equal(manifest.schemaVersion, 1);
assert.ok(manifest.owner);
assert.equal(new Set(manifest.cases.map((x) => x.id)).size, manifest.cases.length);
for (const [name, version] of Object.entries(manifest.plugins)) {
  if (name !== 'qualification-scalar')
    assert.equal(require(`${name}/package.json`).version, version);
}
const upstream = require('postcss');
const plugins = (entry) => [
  entry.plugin === 'qualification-scalar'
    ? {
        postcssPlugin: 'qualification-scalar',
        Declaration(decl) {
          if (decl.value === 'red') decl.value = 'navy';
        },
      }
    : (require(entry.plugin).default ?? require(entry.plugin))(entry.options),
];

function isExpectedHandleUnsupported(error, entry) {
  return (
    entry.expectedHandle === 'unsupported' &&
    error != null &&
    typeof error === 'object' &&
    error.name === 'HandleDeclarationUnsupportedError' &&
    typeof error.property === 'string' &&
    error.property.length > 0
  );
}

const rows = [];
const previous = process.env.POSTCSS_GO_NATIVE_AST;
try {
  for (const entry of manifest.cases) {
    const options = {
      from: '/qualification/input.css',
      to: '/qualification/output.css',
      map: entry.map,
    };
    const expected = await upstream(plugins(entry)).process(entry.css, options);
    const row = { id: entry.id };
    for (const mode of ['binary', 'auto', 'handle']) {
      process.env.POSTCSS_GO_NATIVE_AST = mode;
      let result;
      try {
        result = await new Processor(plugins(entry)).process(entry.css, options);
      } catch (error) {
        if (mode !== 'handle' || !isExpectedHandleUnsupported(error, entry)) throw error;
        row[mode] = { status: 'unsupported', reason: error.message };
        continue;
      }
      assert.equal(result.css, expected.css, `${entry.id}/${mode}`);
      assert.deepEqual(result.warnings().map(String), expected.warnings().map(String));
      const actualMap = result.map?.toJSON();
      const expectedMap = expected.map?.toJSON();
      const difference = manifest.compatibilityDifferences.find((x) => x.case === entry.id);
      if (difference) {
        assert.ok(difference.owner && difference.reason);
        const expectedMappings =
          mode === 'binary' ? difference.binary : (difference.handle ?? difference.binary);
        assert.equal(actualMap.mappings, expectedMappings);
        assert.equal(expectedMap.mappings, difference.upstream);
        assert.deepEqual({ ...actualMap, mappings: '' }, { ...expectedMap, mappings: '' });
        row.mapDifference = difference;
      } else assert.deepEqual(actualMap, expectedMap);
      if (mode === 'handle')
        assert.equal(entry.expectedHandle, 'supported', 'Update manifest after capability review');
      assert.deepEqual(result.messages, expected.messages);
      const nativePlan = result.nativePlan;
      row[mode] = {
        status: difference ? 'known-difference' : 'compatible',
        nativePlan: nativePlan ?? null,
      };
    }
    rows.push(row);
  }
} finally {
  if (previous === undefined) delete process.env.POSTCSS_GO_NATIVE_AST;
  else process.env.POSTCSS_GO_NATIVE_AST = previous;
}

const autoHandleSelected = rows.filter(
  (row) =>
    row.auto?.nativePlan &&
    typeof row.auto.nativePlan.runtime === 'string' &&
    row.auto.nativePlan.runtime.startsWith('handle') &&
    row.auto.nativePlan.hydration === false,
).length;
const required = Math.ceil(rows.length * 0.95);
const summary = {
  corpusVersion: manifest.corpusVersion,
  denominator: rows.length,
  required,
  forcedHandleCompatible: rows.filter(
    (x) => x.handle.status === 'compatible' || x.handle.status === 'known-difference',
  ).length,
  autoHandleSelected,
  autoSelectionGate: autoHandleSelected >= required ? 'passed' : 'failed',
  rows,
};

if (process.argv.includes('--gate')) {
  assert.ok(
    autoHandleSelected >= required,
    `auto handle selection ${autoHandleSelected}/${rows.length} below ${required} (95%)`,
  );
  for (const row of rows) {
    if (row.auto?.nativePlan?.runtime?.startsWith('handle'))
      assert.equal(row.auto.nativePlan.hydration, false, `${row.id} hydrated under auto handle`);
  }
}

console.log(JSON.stringify(summary, null, 2));
