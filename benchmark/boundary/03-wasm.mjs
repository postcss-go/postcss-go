/**
 * Part C of the boundary-cost spike: the same operations over a wasip1 reactor
 * module instead of a native addon.
 *
 * The interesting case is `directMemoryRead`: because Go's heap *is* the WASM
 * linear memory, JS can decode a field straight out of the exported buffer with
 * no crossing at all. A native addon has no equivalent.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WASI } from 'node:wasi';
import { formatNs, legend, measure, table } from './lib/bench.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ARENA = 100_000;

const wasi = new WASI({ version: 'preview1', args: ['core'], env: {} });
const module_ = new WebAssembly.Module(readFileSync(resolve(here, 'wasm/core.wasm')));
const instance = new WebAssembly.Instance(module_, wasi.getImportObject());
wasi.initialize(instance);

const core = instance.exports;
core.pcgoInitArena(ARENA);

const memory = core.memory;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

const scratchPtr = core.pcgoScratchPtr();
const blobPtr = core.pcgoBlobPtr();
const indexPtr = core.pcgoIndexPtr();

/*
 * Any Go allocation can grow linear memory, which detaches every existing JS
 * view. Offsets stay valid because WASM memory only ever grows, so the fix is
 * to rebuild the views whenever the buffer identity changes. That guard is on
 * the hot path, so it is measured as part of every case below.
 */
let buffer = null;
let bytes = null;
let index = null;

function views() {
  if (buffer !== memory.buffer) {
    buffer = memory.buffer;
    bytes = new Uint8Array(buffer);
    index = new Int32Array(buffer, indexPtr, ARENA * 4);
  }
  return bytes;
}

function readProp(handle) {
  const length = core.pcgoGetProp(handle);
  const view = views();
  return decoder.decode(view.subarray(scratchPtr, scratchPtr + length));
}

function writeValue(handle, value) {
  const written = encoder.encodeInto(value, views().subarray(scratchPtr));
  core.pcgoSetValue(handle, written.written);
}

/** Zero-crossing read: JS decodes the field directly from linear memory. */
function directMemoryRead(handle) {
  const view = views();
  const offset = index[handle * 4];
  const length = index[handle * 4 + 1];
  const start = blobPtr + offset;
  return decoder.decode(view.subarray(start, start + length));
}

if (readProp(7) !== directMemoryRead(7)) {
  throw new Error(`memory layout mismatch: ${readProp(7)} vs ${directMemoryRead(7)}`);
}

const cases = [
  { name: 'wasmNoop', detail: 'exported call, empty body', fn: () => core.pcgoNoop() },
  { name: 'wasmAddInt', detail: 'two int args, int return', fn: () => core.pcgoAddInt(3, 4) },
  {
    name: 'wasmGetProp',
    detail: 'call + decode from scratch buffer',
    fn: (() => {
      let i = 0;
      return () => readProp(i++ % ARENA);
    })(),
  },
  {
    name: 'wasmSetValue',
    detail: 'encode into memory + call',
    fn: (() => {
      let i = 0;
      return () => writeValue(i++ % ARENA, '12px solid black');
    })(),
  },
  {
    name: 'directMemoryRead',
    detail: 'no crossing at all',
    fn: (() => {
      let i = 0;
      return () => directMemoryRead(i++ % ARENA);
    })(),
  },
];

const rows = [];
for (const testCase of cases) {
  const { ns } = measure(testCase.fn);
  rows.push({ ...testCase, ns });
}

console.log('# Part C — wasip1 reactor round-trip cost\n');
console.log(
  'The same operations as Part B, but through a WASM module instead of a native\n' +
    'addon. No cgo transition, and Go\u2019s heap is readable JS memory.\n',
);
console.log(
  legend('Directly comparable to the Part B rows of the same name.', [
    ['operation', 'the exported function or memory access being timed'],
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

/*
 * The reads above cost more than the crossings that carry them, so split the
 * work apart: how much is the boundary, and how much is building a JS string?
 */
console.log('\n## Where the time in a field read actually goes\n');
console.log(
  legend('Splits a field read into the crossing and the JS string it produces.', [
    ['crossing only', 'call into Go, discard the bytes'],
    ['TextDecoder.decode', 'turn bytes already in memory into a JS string'],
    ['manual fromCharCode', 'the same, hand-rolled for short ASCII'],
    ['cached JS string', 'reuse a string materialized on an earlier pass'],
  ]),
);

function manualDecode(view, start, length) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(view[start + i]);
  return out;
}

const sampleOffset = blobPtr + index[0];
const sampleLength = index[1];

const breakdown = [
  {
    name: 'crossing only',
    detail: 'call returning a length, no decode',
    fn: (() => {
      let i = 0;
      return () => core.pcgoGetProp(i++ % ARENA);
    })(),
  },
  {
    name: 'TextDecoder.decode',
    detail: `decode ${sampleLength} bytes, no crossing`,
    fn: () => decoder.decode(views().subarray(sampleOffset, sampleOffset + sampleLength)),
  },
  {
    name: 'manual fromCharCode',
    detail: `decode ${sampleLength} ASCII bytes, no crossing`,
    fn: () => manualDecode(views(), sampleOffset, sampleLength),
  },
  {
    name: 'cached JS string',
    detail: 'read a field already materialized once',
    fn: (() => {
      const cache = new Array(ARENA);
      let i = 0;
      return () => {
        const handle = i++ % ARENA;
        cache[handle] ??= directMemoryRead(handle);
        return cache[handle];
      };
    })(),
  },
];

const breakdownRows = [];
for (const testCase of breakdown) {
  const { ns } = measure(testCase.fn);
  breakdownRows.push({ ...testCase, ns });
}
console.log(
  table(breakdownRows, [
    { label: 'operation', value: (r) => r.name },
    { label: 'what it measures', value: (r) => r.detail },
    { label: 'per call', value: (r) => formatNs(r.ns) },
  ]),
);

if (process.env.SPIKE_JSON) {
  const { writeFileSync } = await import('node:fs');
  const costs = Object.fromEntries([...rows, ...breakdownRows].map((row) => [row.name, row.ns]));
  writeFileSync(process.env.SPIKE_JSON, `${JSON.stringify({ costs }, null, 2)}\n`);
}
