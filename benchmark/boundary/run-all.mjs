/**
 * Builds the two native artifacts and runs every part of the spike in order.
 *
 *   node spike/boundary-cost/run-all.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const results = resolve(here, 'results');
mkdirSync(results, { recursive: true });

function run(command, args, options = {}) {
  process.stdout.write(`\n$ ${command} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`);
  }
}

const napiDir = resolve(here, 'napi');
const wasmDir = resolve(here, 'wasm');

console.log('=== Building the Go c-archive and Node addon ===');
run('go', ['build', '-buildmode=c-archive', '-o', 'go-out/libcore.a', './gocore'], {
  cwd: napiDir,
  env: { ...process.env, CGO_ENABLED: '1' },
});
run('npx', ['--yes', 'node-gyp', 'configure', 'build'], { cwd: napiDir });

console.log('\n=== Building the wasip1 reactor module ===');
run('go', ['build', '-buildmode=c-shared', '-o', 'core.wasm', '.'], {
  cwd: wasmDir,
  env: { ...process.env, GOOS: 'wasip1', GOARCH: 'wasm' },
});

const steps = [
  ['01-hydration.mjs', '01-hydration.json'],
  ['02-napi.mjs', '02-napi.json'],
  ['03-wasm.mjs', '03-wasm.json'],
];

for (const [script, artifact] of steps) {
  console.log(`\n${'='.repeat(72)}`);
  run('node', [resolve(here, script)], {
    cwd: repoRoot,
    env: { ...process.env, SPIKE_JSON: resolve(results, artifact) },
  });
}

console.log(`\n${'='.repeat(72)}`);
run('node', [resolve(here, '04-verdict.mjs')], { cwd: repoRoot });
