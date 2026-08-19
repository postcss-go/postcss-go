/**
 * Part E of the boundary-cost suite: measured end-to-end plugin pipelines.
 *
 * Parts A–D price crossings and project a handle-based AST. This script runs
 * the same declaration visitors at 1 / 3 / 5 / 10 / 30 plugins on real CSS
 * through the production binary path, a synthetic JSON DTO path, native
 * handles (uncached, cached, batched+cursor), and WASM handles.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WASI } from 'node:wasi';

import { fromAst, isNativeBridgeAvailable, toAst } from '../../packages/postcss-go/dist/index.js';
import { createNativeService } from '../../packages/postcss-go/dist/native.js';
import { formatNs, legend, measureSlow, table } from './lib/bench.mjs';
import { loadFixtures } from './lib/fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const addon = require('./napi/build/Release/boundary.node');

const FIELD_PROP = 0;
const FIELD_VALUE = 1;
const PLUGIN_COUNTS = [1, 3, 5, 10, 30];
const WALK_CAP = 200_000;

function createPlugins(count) {
  const plugins = [];
  for (let i = 0; i < count; i += 1) {
    const kind = i % 3;
    const id = i;
    plugins.push({
      postcssPlugin: `bench-plugin-${id}`,
      Declaration(decl) {
        if (kind === 0 && decl.prop === 'display') {
          decl.value = `-p${id}-${decl.value}`;
        } else if (kind === 1 && decl.prop === 'color') {
          decl.value = 'navy';
        } else {
          void decl.prop;
          void decl.value;
        }
      },
    });
  }
  return plugins;
}

function applyJsPlugins(root, plugins) {
  for (const plugin of plugins) {
    root.walkDecls((decl) => plugin.Declaration(decl));
  }
}

function runHandleUncached(api, root, count) {
  const buf = api.walkBuf;
  const n = api.walkDecls(root, buf);
  for (let p = 0; p < count; p += 1) {
    const kind = p % 3;
    for (let i = 0; i < n; i += 1) {
      const handle = buf[i];
      const prop = api.getField(handle, FIELD_PROP);
      if (kind === 0 && prop === 'display') {
        api.setField(handle, FIELD_VALUE, `-p${p}-${api.getField(handle, FIELD_VALUE)}`);
      } else if (kind === 1 && prop === 'color') {
        api.setField(handle, FIELD_VALUE, 'navy');
      } else {
        api.getField(handle, FIELD_VALUE);
      }
    }
  }
}

function runHandleCached(api, root, count) {
  const buf = api.walkBuf;
  const n = api.walkDecls(root, buf);
  const props = new Array(n);
  const values = new Array(n);
  for (let i = 0; i < n; i += 1) {
    props[i] = api.getField(buf[i], FIELD_PROP);
    values[i] = api.getField(buf[i], FIELD_VALUE);
  }
  for (let p = 0; p < count; p += 1) {
    const kind = p % 3;
    for (let i = 0; i < n; i += 1) {
      if (kind === 0 && props[i] === 'display') {
        values[i] = `-p${p}-${values[i]}`;
        api.setField(buf[i], FIELD_VALUE, values[i]);
      } else if (kind === 1 && props[i] === 'color') {
        values[i] = 'navy';
        api.setField(buf[i], FIELD_VALUE, values[i]);
      }
    }
  }
}

function runHandleBatched(api, root, count) {
  const buf = api.walkBuf;
  const n = api.cursorWalkDecls(root, buf);
  const handles = buf.subarray(0, n);
  const props = api.readFields(handles, FIELD_PROP);
  let values = api.readFields(handles, FIELD_VALUE);
  for (let p = 0; p < count; p += 1) {
    const kind = p % 3;
    if (kind === 2) continue;
    const next = values.slice();
    let changed = false;
    for (let i = 0; i < n; i += 1) {
      if (kind === 0 && props[i] === 'display') {
        next[i] = `-p${p}-${values[i]}`;
        changed = true;
      } else if (kind === 1 && props[i] === 'color') {
        next[i] = 'navy';
        changed = true;
      }
    }
    if (changed) {
      api.setFields(handles, FIELD_VALUE, next);
      values = next;
    }
  }
}

function createNapiHandles() {
  const walkBuf = new Uint32Array(WALK_CAP);
  return {
    walkBuf,
    parse(css) {
      return addon.handleParse(css);
    },
    close() {
      addon.handleClose();
    },
    stringify(root) {
      return addon.handleStringify(root);
    },
    getField(handle, field) {
      return addon.handleGetField(handle, field);
    },
    setField(handle, field, value) {
      addon.handleSetField(handle, field, value);
    },
    walkDecls(root, buf) {
      const count = addon.handleWalkDecls(root, buf);
      if (count > buf.length) throw new Error(`walkDecls overflow: ${count}`);
      return count;
    },
    cursorWalkDecls(root, buf) {
      const id = addon.handleOpenCursor(root, true);
      let n = 0;
      for (;;) {
        const got = addon.handleCursorNext(id, buf.subarray(n));
        if (got <= 0) break;
        n += got;
        if (n >= buf.length) break;
      }
      addon.handleCloseCursor(id);
      return n;
    },
    readFields(handles, field) {
      return addon.handleReadFields(handles, field);
    },
    setFields(handles, field, values) {
      addon.handleSetFields(handles, field, values);
    },
  };
}

function createWasmHandles() {
  const wasi = new WASI({ version: 'preview1', args: ['core'], env: {} });
  const module_ = new WebAssembly.Module(readFileSync(resolve(here, 'wasm/core.wasm')));
  const instance = new WebAssembly.Instance(module_, wasi.getImportObject());
  wasi.initialize(instance);
  const core = instance.exports;
  const memory = core.memory;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = null;
  let bytes = null;
  const walkBuf = new Uint32Array(WALK_CAP);

  function views() {
    if (buffer !== memory.buffer) {
      buffer = memory.buffer;
      bytes = new Uint8Array(buffer);
    }
    return bytes;
  }

  function copyOut(length) {
    const ptr = core.pcgoHandleScratchPtr();
    return decoder.decode(views().subarray(ptr, ptr + length));
  }

  function syncWalkBuf(count) {
    const ptr = core.pcgoHandleOutPtr();
    const view = new Uint32Array(memory.buffer, ptr, count);
    walkBuf.set(view);
    return count;
  }

  return {
    walkBuf,
    parse(css) {
      const encoded = encoder.encode(css);
      const ptr = core.pcgoHandleEnsureScratch(encoded.length);
      views().set(encoded, ptr);
      const root = core.pcgoHandleParse(encoded.length);
      if (!root) throw new Error('wasm handle parse failed');
      return root >>> 0;
    },
    close() {
      core.pcgoHandleClose();
    },
    stringify(root) {
      const length = core.pcgoHandleStringify(root);
      if (length < 0) throw new Error('wasm handle stringify failed');
      return copyOut(length);
    },
    getField(handle, field) {
      const length = core.pcgoHandleGetField(handle, field);
      if (length < 0) throw new Error('wasm handle getField failed');
      return copyOut(length);
    },
    setField(handle, field, value) {
      const encoded = encoder.encode(value);
      const ptr = core.pcgoHandleEnsureScratch(encoded.length);
      views().set(encoded, ptr);
      if (core.pcgoHandleSetField(handle, field, encoded.length) < 0) {
        throw new Error('wasm handle setField failed');
      }
    },
    walkDecls(root, buf) {
      const count = core.pcgoHandleWalkDecls(root);
      if (count < 0) throw new Error('wasm handle walkDecls failed');
      if (count > buf.length) throw new Error(`walkDecls overflow: ${count}`);
      return syncWalkBuf(count);
    },
    cursorWalkDecls(root, buf) {
      const id = core.pcgoHandleOpenCursor(root, 1);
      let n = 0;
      for (;;) {
        const got = core.pcgoHandleCursorNext(id, Math.min(256, buf.length - n));
        if (got <= 0) break;
        const ptr = core.pcgoHandleOutPtr();
        const view = new Uint32Array(memory.buffer, ptr, got);
        buf.set(view, n);
        n += got;
        if (n >= buf.length) break;
      }
      core.pcgoHandleCloseCursor(id);
      return n;
    },
    readFields(handles, field) {
      const ptr = core.pcgoHandleEnsureOut(handles.length);
      new Uint32Array(memory.buffer, ptr, handles.length).set(handles);
      const written = core.pcgoHandleReadFields(handles.length, field);
      if (written < 0) throw new Error('wasm handle readFields failed');
      const view = views();
      const scratch = core.pcgoHandleScratchPtr();
      const values = [];
      let offset = 0;
      while (offset + 4 <= written) {
        const size =
          view[scratch + offset] |
          (view[scratch + offset + 1] << 8) |
          (view[scratch + offset + 2] << 16) |
          (view[scratch + offset + 3] << 24);
        offset += 4;
        values.push(decoder.decode(view.subarray(scratch + offset, scratch + offset + size)));
        offset += size;
      }
      return values;
    },
    setFields(handles, field, values) {
      const outPtr = core.pcgoHandleEnsureOut(handles.length);
      new Uint32Array(memory.buffer, outPtr, handles.length).set(handles);
      let packed = 0;
      for (const value of values) packed += 4 + encoder.encode(value).length;
      const ptr = core.pcgoHandleEnsureScratch(packed);
      const view = views();
      let offset = 0;
      for (const value of values) {
        const encoded = encoder.encode(value);
        view[ptr + offset] = encoded.length;
        view[ptr + offset + 1] = encoded.length >> 8;
        view[ptr + offset + 2] = encoded.length >> 16;
        view[ptr + offset + 3] = encoded.length >> 24;
        offset += 4;
        view.set(encoded, ptr + offset);
        offset += encoded.length;
      }
      if (core.pcgoHandleSetFields(handles.length, field, offset) < 0) {
        throw new Error('wasm handle setFields failed');
      }
    },
  };
}

function compare(candidate, current) {
  if (candidate < current) return `${(current / candidate).toFixed(2)}x faster`;
  return `${(candidate / current).toFixed(2)}x slower`;
}

async function main() {
  if (!isNativeBridgeAvailable()) {
    throw new Error(
      'Native addon unavailable; build it with `node packages/postcss-go/native/build.mjs`.',
    );
  }

  const native = createNativeService();
  const napiHandles = createNapiHandles();
  const wasmHandles = createWasmHandles();
  const fixtures = loadFixtures().filter((fixture) => fixture.name !== 'Generated10k');
  const rows = [];

  try {
    const probe = '.x { display: flex; color: red; }';
    const probePlugins = createPlugins(2);
    const nativeProbe = native.parseSync(probe, { from: 'probe.css', map: false }).root;
    applyJsPlugins(nativeProbe, probePlugins);
    const expected = native.stringifyResultSync(nativeProbe).css;
    const handleProbe = napiHandles.parse(probe);
    runHandleUncached(napiHandles, handleProbe, 2);
    const handleCss = napiHandles.stringify(handleProbe);
    napiHandles.close();
    if (!expected.includes('navy') || !handleCss.includes('navy') || !handleCss.includes('-p0-')) {
      throw new Error('handle probe did not apply plugin mutations');
    }

    for (const fixture of fixtures) {
      const opts = { from: `${fixture.name}.css`, map: false };
      const jsonWire = JSON.stringify(toAst(native.parseSync(fixture.css, opts).root));
      const pluginsByCount = Object.fromEntries(
        PLUGIN_COUNTS.map((count) => [count, createPlugins(count)]),
      );

      for (const count of PLUGIN_COUNTS) {
        const plugins = pluginsByCount[count];
        const samples = 3;

        const binary = measureSlow(
          () => {
            const root = native.parseSync(fixture.css, opts).root;
            applyJsPlugins(root, plugins);
            native.stringifyResultSync(root);
          },
          { samples },
        );

        const json = measureSlow(
          () => {
            const tree = fromAst(JSON.parse(jsonWire));
            applyJsPlugins(tree, plugins);
            JSON.stringify(toAst(tree));
          },
          { samples },
        );

        const napiUncached = measureSlow(
          () => {
            const root = napiHandles.parse(fixture.css);
            runHandleUncached(napiHandles, root, count);
            napiHandles.stringify(root);
            napiHandles.close();
          },
          { samples },
        );

        const napiCached = measureSlow(
          () => {
            const root = napiHandles.parse(fixture.css);
            runHandleCached(napiHandles, root, count);
            napiHandles.stringify(root);
            napiHandles.close();
          },
          { samples },
        );

        const napiBatched = measureSlow(
          () => {
            const root = napiHandles.parse(fixture.css);
            runHandleBatched(napiHandles, root, count);
            napiHandles.stringify(root);
            napiHandles.close();
          },
          { samples },
        );

        const wasmUncached = measureSlow(
          () => {
            const root = wasmHandles.parse(fixture.css);
            runHandleUncached(wasmHandles, root, count);
            wasmHandles.stringify(root);
            wasmHandles.close();
          },
          { samples },
        );

        const wasmCached = measureSlow(
          () => {
            const root = wasmHandles.parse(fixture.css);
            runHandleCached(wasmHandles, root, count);
            wasmHandles.stringify(root);
            wasmHandles.close();
          },
          { samples },
        );

        const bestHandle = Math.min(
          napiUncached.ns,
          napiCached.ns,
          napiBatched.ns,
          wasmUncached.ns,
          wasmCached.ns,
        );

        rows.push({
          fixture: fixture.name,
          plugins: count,
          binary: binary.ns,
          json: json.ns,
          napiUncached: napiUncached.ns,
          napiCached: napiCached.ns,
          napiBatched: napiBatched.ns,
          wasmUncached: wasmUncached.ns,
          wasmCached: wasmCached.ns,
          bestVsBinary: compare(bestHandle, binary.ns),
        });
      }
    }
  } finally {
    napiHandles.close();
    wasmHandles.close();
    await native.close();
  }

  console.log('# Part E — measured plugin pipelines\n');
  console.log(
    'End-to-end CSS → plugins → CSS on real fixtures. Binary transfer is the\n' +
      'production native path. JSON DTO is a synthetic JS-side baseline. Handle\n' +
      'rows parse and stringify in Go and cross only for plugin field access.\n',
  );
  console.log(
    legend('Each row is one fixture at one plugin count.', [
      ['binary', 'native parseSync + JS visitors + stringifyResultSync'],
      [
        'JSON DTO',
        'JS-only: JSON.parse + fromAst + visitors + toAst + JSON.stringify (no Go parse)',
      ],
      ['NAPI raw', 'opaque handles, one crossing per field'],
      ['NAPI cache', 'handles, fields materialized on the first pass'],
      ['NAPI batch', 'visitor cursor + batched field reads/writes'],
      ['WASM raw', 'wasip1 handles, one crossing per field'],
      ['WASM cache', 'wasip1 handles with a JS field cache'],
      ['best vs binary', 'fastest handle variant against production binary transfer'],
    ]),
  );

  for (const count of PLUGIN_COUNTS) {
    console.log(`## ${count} plugin${count > 1 ? 's' : ''}\n`);
    const subset = rows.filter((row) => row.plugins === count);
    console.log(
      table(subset, [
        { label: 'fixture', value: (r) => r.fixture },
        { label: 'binary', value: (r) => formatNs(r.binary) },
        { label: 'JSON DTO', value: (r) => formatNs(r.json) },
        { label: 'NAPI raw', value: (r) => formatNs(r.napiUncached) },
        { label: 'NAPI cache', value: (r) => formatNs(r.napiCached) },
        { label: 'NAPI batch', value: (r) => formatNs(r.napiBatched) },
        { label: 'WASM raw', value: (r) => formatNs(r.wasmUncached) },
        { label: 'WASM cache', value: (r) => formatNs(r.wasmCached) },
        { label: 'best vs binary', value: (r) => r.bestVsBinary },
      ]),
    );
    console.log('');
  }

  const wins = rows.filter((row) => {
    const best = Math.min(
      row.napiUncached,
      row.napiCached,
      row.napiBatched,
      row.wasmUncached,
      row.wasmCached,
    );
    return best < row.binary;
  });
  const wasmRawLosses = rows.filter((row) => row.wasmUncached > row.binary).length;
  console.log('## Verdict\n');
  console.log(
    `Cached native handles beat binary transfer in ${wins.length} of ${rows.length} pipelines.\n` +
      `Uncached WASM handles were slower than binary in ${wasmRawLosses} pipelines.\n` +
      'Production still ships the compact binary AST: the prototype is not a PostCSS AST\n' +
      'facade (raws, custom nodes, dirty rewalk, Result/helpers), and the WASM Worker\n' +
      'plus DTO boundaries still need a serializable tree. See `internal/asthandle`.\n',
  );

  return rows;
}

const results = await main();
if (process.env.SPIKE_JSON) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.SPIKE_JSON, `${JSON.stringify(results, null, 2)}\n`);
}
