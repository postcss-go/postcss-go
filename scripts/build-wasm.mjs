import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const distDir = path.join(repoRoot, 'packages', 'postcss-go', 'dist', 'wasm');

fs.mkdirSync(distDir, { recursive: true });

const result = spawnSync(
  'go',
  ['build', '-o', path.join(distDir, 'postcss-go.wasm'), './cmd/wasm'],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, GOOS: 'js', GOARCH: 'wasm' },
  },
);
if (result.status !== 0) process.exit(result.status ?? 1);

const goRoot = execFileSync('go', ['env', 'GOROOT'], { encoding: 'utf8' }).trim();
fs.copyFileSync(
  path.join(goRoot, 'lib', 'wasm', 'wasm_exec.js'),
  path.join(distDir, 'wasm_exec.js'),
);

console.log(`Wrote WASM assets to ${distDir}`);
