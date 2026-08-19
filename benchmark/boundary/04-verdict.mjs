/**
 * Synthesis step: combines the op counts from part A with the measured
 * per-crossing costs from parts B and C to project what a handle-based AST
 * would cost, and compares that against the current design.
 *
 * The key asymmetry it models: the current design pays hydration *once* per
 * file no matter how many plugins run, while a handle-based AST pays for every
 * field access in every plugin pass. Real pipelines run many plugins, so the
 * plugin count decides the winner.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatNs, legend, table } from './lib/bench.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const results = resolve(here, 'results');

const read = (name) => JSON.parse(readFileSync(resolve(results, name), 'utf8'));
const hydration = read('01-hydration.json');
const napi = read('02-napi.json').costs;
const wasm = read('03-wasm.json').costs;

/** Cost model for one plugin pass over a tree, per backend. */
const backends = {
  napi: {
    label: 'NAPI + cgo',
    scalar: napi.cgoAddInt,
    read: napi.cgoGetProp,
    write: napi.cgoSetValue,
  },
  wasm: {
    label: 'wasip1 reactor',
    scalar: wasm.wasmAddInt,
    read: wasm.wasmGetProp,
    write: wasm.wasmSetValue,
  },
  wasmDirect: {
    label: 'wasip1 + direct memory reads',
    scalar: wasm.wasmAddInt,
    read: wasm.directMemoryRead,
    write: wasm.wasmSetValue,
  },
};

function passCost(row, backend) {
  return (
    row.ops.traversal * backend.scalar +
    row.ops.reads * backend.read +
    row.ops.writes * backend.write +
    row.ops.structural * backend.scalar
  );
}

console.log('# Part D — projected handle cost vs current design\n');
console.log(
  'Projected, not measured: per-crossing costs from Parts B and C multiplied by\n' +
    'the operation counts from Part A. Part E measures real plugin pipelines on\n' +
    'the prototype handle ABI; use that for the adopt/keep-binary decision.\n',
);

console.log('## Cost of one plugin pass\n');
console.log(
  legend('One walk over the tree, priced under each candidate boundary.', [
    ['nodes', 'AST nodes, including the root'],
    ['native calls', 'crossings a handle-based walk would need'],
    ['current (wire + hydrate)', 'measured JSON encode, decode, fromAst, and toAst'],
    ['NAPI', 'native addon crossings, from Part B'],
    ['wasip1', 'WASM crossings, from Part C'],
    ['wasip1 direct', 'as above, reading fields straight from linear memory'],
  ]),
);

console.log(
  table(hydration, [
    { label: 'fixture', value: (r) => r.fixture },
    { label: 'nodes', value: (r) => r.nodes.toLocaleString() },
    { label: 'native calls', value: (r) => r.opsTotal.toLocaleString() },
    { label: 'current (wire + hydrate)', value: (r) => formatNs(r.currentTotal) },
    { label: 'NAPI', value: (r) => formatNs(passCost(r, backends.napi)) },
    { label: 'wasip1', value: (r) => formatNs(passCost(r, backends.wasm)) },
    { label: 'wasip1 direct', value: (r) => formatNs(passCost(r, backends.wasmDirect)) },
  ]),
);

console.log(
  '\nThe current design pays its cost once per file. A handle-based AST pays\n' +
    'per pass, so the comparison depends on how many plugins run.\n',
);

/*
 * The obvious mitigation for repeated passes is to cache each field on its JS
 * wrapper after the first read, so later passes never cross. Writes still have
 * to reach Go. This is the most favorable realistic handle-model variant.
 */
function cachedCost(row, backend, pluginCount) {
  const first = passCost(row, backend);
  const cachedRead = wasm['cached JS string'];
  const later =
    row.ops.traversal * cachedRead +
    row.ops.reads * cachedRead +
    row.ops.writes * backend.write +
    row.ops.structural * backend.scalar;
  return first + later * (pluginCount - 1);
}

const compare = (candidate, current) =>
  candidate < current
    ? `${(current / candidate).toFixed(2)}x faster`
    : `${(candidate / current).toFixed(2)}x slower`;

console.log(
  legend('Columns repeated for every pipeline size below.', [
    ['current', 'measured cost of the JSON DTO round trip, paid once per file'],
    ['NAPI handles', 'projected native crossings, paid again on every pass'],
    ['wasip1 handles', 'the same over WASM'],
    ['NAPI + field cache', 'handles, but each field is materialized only once'],
    ['best vs current', 'the fastest candidate against the current design'],
  ]),
);

for (const pluginCount of [1, 3, 5, 10, 30]) {
  console.log(`## Pipeline with ${pluginCount} plugin${pluginCount > 1 ? 's' : ''}\n`);
  const rows = hydration.map((row) => ({
    fixture: row.fixture,
    current: row.currentTotal,
    napiTotal: passCost(row, backends.napi) * pluginCount,
    wasmTotal: passCost(row, backends.wasm) * pluginCount,
    napiCached: cachedCost(row, backends.napi, pluginCount),
  }));

  console.log(
    table(rows, [
      { label: 'fixture', value: (r) => r.fixture },
      { label: 'current', value: (r) => formatNs(r.current) },
      { label: 'NAPI handles', value: (r) => formatNs(r.napiTotal) },
      { label: 'wasip1 handles', value: (r) => formatNs(r.wasmTotal) },
      { label: 'NAPI + field cache', value: (r) => formatNs(r.napiCached) },
      {
        label: 'best vs current',
        value: (r) => compare(Math.min(r.napiTotal, r.wasmTotal, r.napiCached), r.current),
      },
    ]),
  );
  console.log('');
}

console.log('## Boundary cost floor, for reference\n');
console.log(
  legend('The measured numbers the projections above are built from.', [
    ['operation', 'the boundary primitive being priced'],
    ['per call', 'measured wall time for one call'],
  ]),
);
console.log(
  table(
    [
      { name: 'NAPI dispatch only', ns: napi.nativeNoop },
      { name: 'NAPI + cgo, empty', ns: napi.cgoNoop },
      { name: 'wasip1 call, empty', ns: wasm.wasmNoop },
      { name: 'NAPI string read', ns: napi.cgoGetProp },
      { name: 'wasip1 string read', ns: wasm.wasmGetProp },
      { name: 'TextDecoder alone (no crossing)', ns: wasm['TextDecoder.decode'] },
      { name: 'already-materialized JS string', ns: wasm['cached JS string'] },
    ],
    [
      { label: 'operation', value: (r) => r.name },
      { label: 'per call', value: (r) => formatNs(r.ns) },
    ],
  ),
);
