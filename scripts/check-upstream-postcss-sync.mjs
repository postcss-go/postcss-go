#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const expectedDir = path.join(repoRoot, 'vendor', 'postcss');
let upstreamRepo = process.env.UPSTREAM_REPO ?? 'https://github.com/postcss/postcss';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postcss-go-check-'));

function cleanup() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

function collectFiles(dir, base = dir, files = new Map()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full);
    if (entry.isDirectory()) {
      collectFiles(full, base, files);
    } else {
      files.set(rel, fs.readFileSync(full));
    }
  }
  return files;
}

function diffDirs(left, right) {
  const leftFiles = collectFiles(left);
  const rightFiles = collectFiles(right);
  const diffs = [];

  for (const rel of new Set([...leftFiles.keys(), ...rightFiles.keys()])) {
    if (!leftFiles.has(rel)) {
      diffs.push(`Only in ${right}: ${rel}`);
    } else if (!rightFiles.has(rel)) {
      diffs.push(`Only in ${left}: ${rel}`);
    } else if (!leftFiles.get(rel).equals(rightFiles.get(rel))) {
      diffs.push(`Files ${path.join(left, rel)} and ${path.join(right, rel)} differ`);
    }
  }

  return diffs;
}

if (
  !fs.existsSync(path.join(expectedDir, 'test')) ||
  !fs.existsSync(path.join(expectedDir, 'lib'))
) {
  console.error(`Missing vendored upstream PostCSS snapshot at ${expectedDir}`);
  console.error('Run `node ./scripts/sync-upstream-postcss-tests.mjs` first.');
  process.exit(1);
}

let upstreamRef;
let preserveSourceJson = false;

if (process.argv.length > 2) {
  upstreamRef = process.argv[2];
} else {
  const sourcePath = path.join(expectedDir, 'SOURCE.json');
  if (!fs.existsSync(sourcePath)) {
    console.error(`Missing vendored upstream PostCSS source metadata at ${sourcePath}`);
    console.error('Run `node ./scripts/sync-upstream-postcss-tests.mjs` first.');
    process.exit(1);
  }
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  upstreamRepo = source.repo || '';
  upstreamRef = source.commit || source.ref || '';
  preserveSourceJson = true;
}

if (!upstreamRepo || !upstreamRef) {
  console.error('Unable to determine upstream PostCSS source.');
  process.exit(1);
}

const syncResult = spawnSync(
  process.execPath,
  [path.join(scriptDir, 'sync-upstream-postcss-tests.mjs'), upstreamRef],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      SKIP_PREPARE_COMPAT: '1',
      UPSTREAM_REPO: upstreamRepo,
      TARGET_DIR: path.join(tmpDir, 'postcss'),
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  },
);

if (syncResult.status !== 0) process.exit(syncResult.status ?? 1);

const actualDir = path.join(tmpDir, 'postcss');
if (preserveSourceJson) {
  fs.copyFileSync(path.join(expectedDir, 'SOURCE.json'), path.join(actualDir, 'SOURCE.json'));
}

const diffs = diffDirs(expectedDir, actualDir);
if (diffs.length > 0) {
  console.error('Vendored upstream PostCSS snapshot is out of date.');
  console.error('Run `node ./scripts/sync-upstream-postcss-tests.mjs` and commit the result.');
  const sourcePath = path.join(expectedDir, 'SOURCE.json');
  if (fs.existsSync(sourcePath)) {
    const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    console.error('Current snapshot:');
    console.error(`  ${source.repo}@${source.ref} (${source.commit})`);
  }
  for (const line of diffs) console.error(line);
  process.exit(1);
}

const sourcePath = path.join(expectedDir, 'SOURCE.json');
if (fs.existsSync(sourcePath)) {
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  console.log(`Vendored upstream PostCSS snapshot is in sync (${source.commit}).`);
} else {
  console.log('Vendored upstream PostCSS snapshot is in sync.');
}
