#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDirectory = mkdtempSync(resolve(tmpdir(), 'postcss-go-release-'));
const manifestPath = resolve(releaseDirectory, 'native-artifacts.json');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with status ${result.status ?? 1}`);
  }
}

try {
  run(process.execPath, ['./scripts/check-native-artifacts.mjs', 'snapshot', manifestPath]);
  run(pnpm, ['build:release']);
  run(process.execPath, ['./scripts/check-native-artifacts.mjs', 'verify', manifestPath]);
  run(pnpm, ['changeset:publish']);
} finally {
  rmSync(releaseDirectory, { recursive: true, force: true });
}
