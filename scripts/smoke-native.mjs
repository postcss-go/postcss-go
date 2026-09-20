#!/usr/bin/env node

/**
 * Packs @postcss-go/core and the host native platform package, installs both
 * tarballs into a clean directory, and exercises the public async/sync APIs
 * (including a Worker Thread). CI uses this so the published layout is tested,
 * not node-gyp's local build directory.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { currentNativePackageName, currentNativeTuple } from './native-platforms.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const isWindows = process.platform === 'win32';
const pnpm = isWindows ? 'pnpm.cmd' : 'pnpm';
const npm = isWindows ? 'npm.cmd' : 'npm';

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: isWindows,
    ...options,
  });
}

async function smoke(packageName, cwd) {
  const api = await import(packageName);
  const expectedNativePackage = currentNativePackageName();
  const installedRequire = createRequire(resolve(cwd, 'package.json'));
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

  await new Promise((resolvePromise, reject) => {
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
        parentPort.close();
      })().catch((error) => { throw error; });
    `,
      { eval: true, workerData: { packageName } },
    );
    worker.once('error', reject);
    worker.once('message', async (css) => {
      try {
        assert.equal(css, 'w{display:block}');
        await worker.terminate();
        resolvePromise();
      } catch (error) {
        reject(error);
      }
    });
  });
}

const staging = mkdtempSync(resolve(tmpdir(), 'postcss-go-native-pack-'));
try {
  const directories = [
    resolve(repoRoot, 'packages/postcss-go'),
    resolve(repoRoot, 'npm/postcss-go', currentNativeTuple()),
  ];
  for (const directory of directories) {
    run(pnpm, ['--dir', directory, 'pack', '--pack-destination', staging]);
  }

  const tarballs = directories.map((directory) => {
    const pkg = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
    return resolve(staging, `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`);
  });

  writeFileSync(
    resolve(staging, 'package.json'),
    `${JSON.stringify({ name: 'native-pack-staging', private: true }, null, 2)}\n`,
  );
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs], {
    cwd: staging,
  });

  const installedEntry = pathToFileURL(
    resolve(staging, 'node_modules/@postcss-go/core/dist/index.js'),
  ).href;
  await smoke(installedEntry, staging);
  console.log(`postcss-go: native package smoke passed for ${process.platform}-${process.arch}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
