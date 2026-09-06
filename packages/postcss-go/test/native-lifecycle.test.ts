import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

import { isNativeBridgeAvailable } from '../src/native.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entryUrl = pathToFileURL(resolve(packageRoot, 'dist/index.js')).href;

test.runIf(isNativeBridgeAvailable())(
  'parallel workers isolate native handle sessions',
  async () => {
    await Promise.all(
      Array.from(
        { length: 4 },
        (_, id) =>
          new Promise<void>((done, reject) => {
            const worker = new Worker(
              `
      const {workerData} = require('node:worker_threads');
      (async () => {
        process.env.POSTCSS_GO_NATIVE_AST = 'handle';
        const {Processor} = await import(workerData.entryUrl);
        const processor = new Processor([{postcssPlugin: 'worker', Declaration(decl) {decl.value = String(workerData.id);}}]);
        for (let i = 0; i < 30; i++) {
          const css = processor.processSync('a{x:old;y:old}', {map:false}).css;
          if (css !== 'a{x:' + workerData.id + ';y:' + workerData.id + '}') throw new Error(css);
          await new Promise(setImmediate);
        }
      })().catch(error => {throw error;});
    `,
              { eval: true, workerData: { entryUrl, id } },
            );
            worker.once('error', reject);
            worker.once('exit', (code) =>
              code === 0 ? done() : reject(new Error('worker exit ' + code)),
            );
          }),
      ),
    );
  },
);

test.runIf(isNativeBridgeAvailable())(
  'native addon is owned independently by a Worker Thread',
  async () => {
    const result = await new Promise<string>((resolveMessage, reject) => {
      const worker = new Worker(
        `
          const { parentPort, workerData } = require('node:worker_threads');
          (async () => {
            const api = await import(workerData.entryUrl);
            const root = api.parseSync('worker{color:green}');
            if (api.stringifySync(root) !== 'worker{color:green}') {
              throw new Error('sync Worker round trip failed');
            }
            parentPort.postMessage((await api.process('worker{color:green}')).css);
          })().catch((error) => { throw error; });
        `,
        { eval: true, workerData: { entryUrl } },
      );
      worker.once('message', resolveMessage);
      worker.once('error', reject);
    });

    expect(result).toBe('worker{color:green}');
  },
);

test.runIf(isNativeBridgeAvailable())(
  'process exits cleanly after native async and sync work completes',
  () => {
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
          const api = await import(${JSON.stringify(entryUrl)});
          const root = api.parseSync('child{display:block}');
          if (api.stringifySync(root) !== 'child{display:block}') process.exitCode = 2;
          if ((await api.noWork('child{display:block}')).css !== 'child{display:block}') {
            process.exitCode = 3;
          }
        `,
      ],
      { encoding: 'utf8', timeout: 15_000 },
    );

    expect(child.signal).toBeNull();
    expect(child.status, child.stderr).toBe(0);
  },
);
