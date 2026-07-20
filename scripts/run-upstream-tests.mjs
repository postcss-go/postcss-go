#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const upstreamDir = path.join(repoRoot, 'vendor', 'postcss');
const mode = process.env.POSTCSS_COMPAT_MODE ?? 'upstream';
const pattern = process.env.UPSTREAM_TEST_PATTERN ?? '\\.test\\.(ts|js)$';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postcss-go-upstream-'));
const bridgeClient = path.join(repoRoot, 'packages', 'postcss-compat', 'bridge-client.cjs');

function cleanup() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result;
}

const env = { ...process.env, POSTCSS_COMPAT_MODE: mode, FORCE_COLOR: '1' };
delete env.NO_COLOR;

if (
  !fs.existsSync(path.join(upstreamDir, 'test')) ||
  !fs.existsSync(path.join(upstreamDir, 'lib'))
) {
  console.error('Missing vendored upstream PostCSS snapshot.');
  console.error('Run `node ./scripts/sync-upstream-postcss-tests.mjs` first.');
  process.exit(1);
}

const compatDir = path.join(tmpDir, 'postcss');
fs.cpSync(upstreamDir, compatDir, { recursive: true });

run(process.execPath, [path.join(scriptDir, 'prepare-upstream-compat.mjs')], {
  cwd: repoRoot,
  env: {
    ...env,
    POSTCSS_COMPAT_TARGET_LIB: path.join(compatDir, 'lib'),
    POSTCSS_GO_COMPAT_BRIDGE_CLIENT: bridgeClient,
  },
});

const testDir = path.join(compatDir, 'test');
const uvuArgs = [
  '--dir',
  path.join(repoRoot, 'packages', 'postcss-compat'),
  'exec',
  'uvu',
  '-r',
  path.join(repoRoot, 'packages', 'postcss-compat', 'register.cjs'),
  testDir,
  pattern,
];

const uvuEnv = { ...env };
if (mode === 'go') {
  uvuEnv.POSTCSS_GO_COMPAT_BRIDGE_CLIENT = bridgeClient;
}

run('pnpm', uvuArgs, { cwd: repoRoot, env: uvuEnv });
