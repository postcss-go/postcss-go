/**
 * Builds the two native artifacts and runs the JavaScript and Go boundary
 * benchmarks in order.
 *
 *   pnpm bench:boundary
 *   node benchmark/run-boundary.mjs [--js-only | --go-only]
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const boundaryDir = resolve(here, 'boundary');
const results = resolve(boundaryDir, 'results');
mkdirSync(results, { recursive: true });

const args = new Set(process.argv.slice(2));
const allowedArgs = new Set(['--js-only', '--go-only']);
const unknownArgs = [...args].filter((arg) => !allowedArgs.has(arg));
if (unknownArgs.length > 0 || (args.has('--js-only') && args.has('--go-only'))) {
  console.error('Usage: node benchmark/run-boundary.mjs [--js-only | --go-only]');
  process.exit(1);
}

const runJavaScript = !args.has('--go-only');
const runGo = !args.has('--js-only');

function run(command, args, options = {}) {
  process.stdout.write(`\n$ ${command} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`);
  }
}

if (runJavaScript) {
  const napiDir = resolve(boundaryDir, 'napi');
  const wasmDir = resolve(boundaryDir, 'wasm');

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
    run('node', [resolve(boundaryDir, script)], {
      cwd: repoRoot,
      env: { ...process.env, SPIKE_JSON: resolve(results, artifact) },
    });
  }

  console.log(`\n${'='.repeat(72)}`);
  run('node', [resolve(boundaryDir, '04-verdict.mjs')], { cwd: repoRoot });
}

if (runGo) {
  console.log(`\n${'='.repeat(72)}`);
  console.log('=== Running the Go boundary benchmarks ===');
  run(
    'go',
    ['test', '-mod=mod', './benchmark/boundary/', '-bench=.', '-benchmem', '-benchtime=100ms'],
    { cwd: repoRoot },
  );
}
