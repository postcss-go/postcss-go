import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const distDir = path.join(repoRoot, 'packages', 'postcss-go', 'dist', 'wasm');
const goRoot = execFileSync('go', ['env', 'GOROOT'], { encoding: 'utf8' }).trim();

fs.mkdirSync(distDir, { recursive: true });

/** Go requires GOCACHE or LocalAppData; Turbo strict mode may strip the latter on Windows. */
function withGoCache(env) {
  if (env.GOCACHE || env.LOCALAPPDATA || env.LocalAppData) return env;
  return { ...env, GOCACHE: path.join(os.homedir(), '.cache', 'go-build') };
}

function go(args, env = process.env) {
  const result = spawnSync('go', args, { cwd: repoRoot, stdio: 'inherit', env });
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

go(['generate', './internal/asthandle'], withGoCache(process.env));
go(
  ['build', '-o', path.join(distDir, 'postcss-go.wasm'), './cmd/wasm'],
  withGoCache({
    ...process.env,
    GOOS: 'js',
    GOARCH: 'wasm',
  }),
);

fs.copyFileSync(
  path.join(goRoot, 'lib', 'wasm', 'wasm_exec.js'),
  path.join(distDir, 'wasm_exec.js'),
);

// js/wasm rejects oversized argv+environment blocks; keep only what the toolchain needs.
const wasmTestEnv = withGoCache({
  GOOS: 'js',
  GOARCH: 'wasm',
  PATH: `${process.env.PATH ?? ''}${path.delimiter}${path.join(goRoot, 'lib', 'wasm')}`,
  HOME: process.env.HOME ?? os.homedir(),
  GOCACHE: process.env.GOCACHE ?? path.join(os.homedir(), '.cache', 'go-build'),
});
for (const name of ['GOMODCACHE', 'GOPATH', 'SystemRoot', 'LOCALAPPDATA', 'LocalAppData']) {
  if (process.env[name]) wasmTestEnv[name] = process.env[name];
}
go(['test', '-mod=mod', '-run', 'Handle', './cmd/wasm'], wasmTestEnv);

console.log(`Wrote WASM assets to ${distDir}`);
