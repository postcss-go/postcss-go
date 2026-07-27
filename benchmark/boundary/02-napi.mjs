/**
 * Part B of the boundary-cost spike: the price of one NAPI + cgo round trip.
 *
 * `nativeNoop` never enters Go, so the gap between it and `cgoNoop` is the cgo
 * transition cost on its own. The string cases are what a handle-based AST
 * would actually pay for `decl.prop` and `decl.value = x`.
 */
import { createRequire } from 'node:module';
import { formatNs, legend, measure, table } from './lib/bench.mjs';

const require = createRequire(import.meta.url);
const addon = require('./napi/build/Release/boundary.node');

const ARENA = 100_000;
addon.initArena(ARENA);

const cases = [
  {
    name: 'nativeNoop',
    detail: 'NAPI dispatch only, no cgo',
    fn: () => addon.nativeNoop(),
  },
  {
    name: 'cgoNoop',
    detail: 'NAPI + cgo transition',
    fn: () => addon.cgoNoop(),
  },
  {
    name: 'cgoAddInt',
    detail: 'two int args, int return',
    fn: () => addon.cgoAddInt(3, 4),
  },
  {
    name: 'cgoGetProp',
    detail: 'read a Go string as a JS string',
    fn: (() => {
      let i = 0;
      return () => addon.cgoGetProp(i++ % ARENA);
    })(),
  },
  {
    name: 'cgoSetValue',
    detail: 'write a JS string into Go',
    fn: (() => {
      let i = 0;
      return () => addon.cgoSetValue(i++ % ARENA, '12px solid black');
    })(),
  },
];

const rows = [];
for (const testCase of cases) {
  const { ns } = measure(testCase.fn);
  rows.push({ ...testCase, ns });
}

console.log('# Part B — NAPI + cgo round-trip cost\n');
console.log(
  'The price of one synchronous crossing into Go through a Node-API addon.\n' +
    'Compare these against the break-even figure from Part A.\n',
);
console.log(
  legend('Each row adds one layer, so the differences isolate each cost.', [
    ['operation', 'the binding being called in a tight loop'],
    ['what it measures', 'the layer this row adds over the row above'],
    ['per call', 'wall time for one call, best of several samples'],
  ]),
);
console.log(
  table(rows, [
    { label: 'operation', value: (r) => r.name },
    { label: 'what it measures', value: (r) => r.detail },
    { label: 'per call', value: (r) => formatNs(r.ns) },
  ]),
);

const napiOnly = rows.find((row) => row.name === 'nativeNoop').ns;
const withCgo = rows.find((row) => row.name === 'cgoNoop').ns;
console.log(
  `\ncgo transition alone: ${formatNs(withCgo - napiOnly)} ` +
    `(${formatNs(napiOnly)} NAPI + ${formatNs(withCgo - napiOnly)} cgo)`,
);

console.log('\n## Batching amortization (prop + value pairs per crossing)\n');
console.log(
  legend('Does fetching many fields at once pay for itself?', [
    ['batch size', 'declarations fetched in a single crossing'],
    ['per crossing', 'wall time for the whole batched call'],
    ['per field', 'per crossing divided by fields returned'],
  ]),
);
const batchRows = [];
for (const batch of [1, 2, 8, 32, 128, 512, 2048]) {
  const { ns } = measure(
    (() => {
      let i = 0;
      return () => {
        addon.cgoGetPropsBatch(i % (ARENA - batch), batch);
        i += batch;
      };
    })(),
  );
  batchRows.push({ batch, ns, perField: ns / (batch * 2) });
}
console.log(
  table(batchRows, [
    { label: 'batch size', value: (r) => r.batch },
    { label: 'per crossing', value: (r) => formatNs(r.ns) },
    { label: 'per field', value: (r) => formatNs(r.perField) },
  ]),
);

if (process.env.SPIKE_JSON) {
  const { writeFileSync } = await import('node:fs');
  const costs = Object.fromEntries(rows.map((row) => [row.name, row.ns]));
  writeFileSync(
    process.env.SPIKE_JSON,
    `${JSON.stringify({ costs, batches: batchRows }, null, 2)}\n`,
  );
}
