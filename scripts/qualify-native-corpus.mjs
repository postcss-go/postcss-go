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
    error.property === 'plugin run or source maps'
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
        assert.equal(actualMap.mappings, difference.binary);
        assert.equal(expectedMap.mappings, difference.upstream);
        assert.deepEqual({ ...actualMap, mappings: '' }, { ...expectedMap, mappings: '' });
        row.mapDifference = difference;
      } else assert.deepEqual(actualMap, expectedMap);
      if (mode === 'handle')
        assert.equal(entry.expectedHandle, 'supported', 'Update manifest after capability review');
      assert.deepEqual(result.messages, expected.messages);
      row[mode] = { status: difference ? 'known-difference' : 'compatible' };
    }
    rows.push(row);
  }
} finally {
  if (previous === undefined) delete process.env.POSTCSS_GO_NATIVE_AST;
  else process.env.POSTCSS_GO_NATIVE_AST = previous;
}
if (process.argv.includes('--gate'))
  assert.fail(
    'Auto handle selection and no-hydration instrumentation are not implemented; rollout gate is blocked',
  );
console.log(
  JSON.stringify(
    {
      corpusVersion: manifest.corpusVersion,
      denominator: rows.length,
      required: Math.ceil(rows.length * 0.95),
      forcedHandleCompatible: rows.filter((x) => x.handle.status === 'compatible').length,
      autoSelectionGate: 'unverified; auto currently uses binary',
      rows,
    },
    null,
    2,
  ),
);
