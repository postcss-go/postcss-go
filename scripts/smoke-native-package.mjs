#!/usr/bin/env node

/**
 * Exercises the installed host addon through every public async and sync API,
 * then repeats work in a Worker Thread. CI runs this after packing/installing
 * the platform package so it validates the published layout, not node-gyp's
 * local build directory.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';

const packageName = process.argv[2] ?? '@postcss-go/core';
const api = await import(packageName);

function nativeTuple() {
  if (process.platform === 'linux') {
    const report = process.report?.getReport();
    const libc = report?.header?.glibcVersionRuntime ? 'gnu' : 'musl';
    return `linux-${process.arch}-${libc}`;
  }
  if (process.platform === 'win32') return `win32-${process.arch}-msvc`;
  return `${process.platform}-${process.arch}`;
}

const expectedNativePackage = `@postcss-go/native-${nativeTuple()}`;
const installedRequire = createRequire(resolve(process.cwd(), 'package.json'));
try {
  installedRequire(expectedNativePackage);
} catch (error) {
  throw new Error(
    `postcss-go: failed to load ${expectedNativePackage}: ${error instanceof Error ? error.stack : String(error)}`,
    { cause: error },
  );
}

assert.equal(
  api.isNativeBridgeAvailable(),
  true,
  'native bridge must load from the packed package',
);
assert.equal(
  api.getBackendCapabilities().synchronous?.backend,
  'native',
  'packed sync backend must be native',
);
assert.equal(
  api.getBackendCapabilities().asynchronous?.backend,
  'native',
  'packed async backend must be native',
);

const syncRoot = api.parseSync('a{color:red}', { from: 'sync.css' });
assert.equal(syncRoot.type, 'root');
assert.equal(api.stringifySync(syncRoot), 'a{color:red}');
assert.equal(api.processSync('a{color:red}').css, 'a{color:red}');
assert.equal(api.noWorkSync('a{color:red}').css, 'a{color:red}');

const asyncRoot = await api.parse('b{color:blue}', { from: 'async.css' });
assert.equal(asyncRoot.type, 'root');
assert.equal(await api.stringify(asyncRoot), 'b{color:blue}');
assert.equal((await api.process('b{color:blue}')).css, 'b{color:blue}');
assert.equal((await api.noWork('b{color:blue}')).css, 'b{color:blue}');

await new Promise((resolve, reject) => {
  const worker = new Worker(
    `
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const api = await import(workerData.packageName);
        const root = api.parseSync('w{display:block}');
        if (api.stringifySync(root) !== 'w{display:block}') {
          throw new Error('Worker sync native smoke failed');
        }
        const result = await api.process('w{display:block}');
        parentPort.postMessage(result.css);
      })().catch((error) => { throw error; });
    `,
    {
      eval: true,
      workerData: { packageName },
    },
  );
  worker.once('error', reject);
  worker.once('message', (css) => {
    try {
      assert.equal(css, 'w{display:block}');
      resolve();
    } catch (error) {
      reject(error);
    }
  });
});

console.log(`postcss-go: native package smoke passed for ${process.platform}-${process.arch}`);
