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

const rows = [];
for (const entry of manifest.cases) {
  const options = {
    from: '/qualification/input.css',
    to: '/qualification/output.css',
    map: entry.map,
  };
  const expected = await upstream(plugins(entry)).process(entry.css, options);
  assert.equal(entry.expectedHandle, 'supported', 'Update manifest after capability review');
  const result = await new Processor(plugins(entry)).process(entry.css, options);
  assert.equal(result.css, expected.css, entry.id);
  assert.deepEqual(result.warnings().map(String), expected.warnings().map(String));
  const actualMap = result.map?.toJSON();
  const expectedMap = expected.map?.toJSON();
  const difference = manifest.compatibilityDifferences.find((x) => x.case === entry.id);
  const row = { id: entry.id };
  if (difference) {
    assert.ok(difference.owner && difference.reason);
    assert.equal(actualMap.mappings, difference.handle ?? difference.binary);
    assert.equal(expectedMap.mappings, difference.upstream);
    assert.deepEqual({ ...actualMap, mappings: '' }, { ...expectedMap, mappings: '' });
    row.mapDifference = difference;
  } else assert.deepEqual(actualMap, expectedMap);
  assert.deepEqual(result.messages, expected.messages);
  row.status = difference ? 'known-difference' : 'compatible';
  row.nativePlan = result.nativePlan ?? null;
  rows.push(row);
}

const handleSelected = rows.filter(
  (row) =>
    row.nativePlan &&
    typeof row.nativePlan.runtime === 'string' &&
    row.nativePlan.runtime.startsWith('handle') &&
    row.nativePlan.hydration === false,
).length;
const required = Math.ceil(rows.length * 0.95);
const summary = {
  corpusVersion: manifest.corpusVersion,
  denominator: rows.length,
  required,
  handleSelected,
  handleSelectionGate: handleSelected >= required ? 'passed' : 'failed',
  rows,
};

if (process.argv.includes('--gate')) {
  assert.ok(
    handleSelected >= required,
    `handle selection ${handleSelected}/${rows.length} below ${required} (95%)`,
  );
  for (const row of rows) {
    if (row.nativePlan?.runtime?.startsWith('handle'))
      assert.equal(row.nativePlan.hydration, false, `${row.id} hydrated under handle`);
  }
}

console.log(JSON.stringify(summary, null, 2));
