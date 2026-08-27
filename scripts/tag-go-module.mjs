#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(
  readFileSync(resolve(repoRoot, 'packages/postcss-go/package.json'), 'utf8'),
).version;
const tag = `v${version}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: options.stdio ?? 'inherit',
    encoding: options.encoding,
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with status ${result.status ?? 1}`);
  }
  return result;
}

run('git', ['fetch', '--tags', 'origin'], { stdio: 'pipe' });

const localTag = run('git', ['tag', '--list', tag], { stdio: 'pipe', encoding: 'utf8' });
if (localTag.stdout.trim() === tag) {
  console.log(`postcss-go: Go module tag ${tag} already exists locally`);
  process.exit(0);
}

const remoteTag = run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], {
  stdio: 'pipe',
  encoding: 'utf8',
});
if (remoteTag.stdout.trim()) {
  console.log(`postcss-go: Go module tag ${tag} already exists on origin`);
  process.exit(0);
}

run('git', ['tag', '-a', tag, '-m', `Release ${tag}`]);
run('git', ['push', 'origin', tag]);
console.log(`postcss-go: tagged and pushed Go module release ${tag}`);
