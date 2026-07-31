#!/usr/bin/env node

/**
 * Exercises the installed host addon through every public async and sync API,
 * then repeats work in a Worker Thread. CI runs this after packing/installing
 * the platform package so it validates the published layout, not node-gyp's
 * local build directory.
 */
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';

const packageName = process.argv[2] ?? '@postcss-go/core';
const api = await import(packageName);

assert.equal(api.isNativeBridgeAvailable(), true);
assert.equal(api.getBackendCapabilities().synchronous?.backend, 'native');
assert.equal(api.getBackendCapabilities().asynchronous?.backend, 'native');

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
