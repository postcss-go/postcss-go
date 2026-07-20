#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const upstreamRepo = process.env.UPSTREAM_REPO ?? 'https://github.com/postcss/postcss';
const upstreamRef = process.argv[2] ?? process.env.UPSTREAM_REF ?? 'main';
const targetDir = process.env.TARGET_DIR ?? path.join(repoRoot, 'vendor', 'postcss');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postcss-go-sync-'));

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

async function download(url, dest) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  fs.writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
}

const archiveUrl = `${upstreamRepo.replace(/\/$/, '')}/archive/${upstreamRef}.tar.gz`;
const archivePath = path.join(tmpDir, 'postcss.tar.gz');

try {
  await download(archiveUrl, archivePath);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
run('tar', ['-xzf', archivePath, '-C', tmpDir]);

fs.mkdirSync(targetDir, { recursive: true });
fs.rmSync(path.join(targetDir, 'test'), { recursive: true, force: true });
fs.rmSync(path.join(targetDir, 'lib'), { recursive: true, force: true });

const sourceDir = fs
  .readdirSync(tmpDir, { withFileTypes: true })
  .find((entry) => entry.isDirectory())?.name;

if (!sourceDir) {
  console.error('Unable to find extracted PostCSS archive directory.');
  process.exit(1);
}

const extracted = path.join(tmpDir, sourceDir);
fs.cpSync(path.join(extracted, 'test'), path.join(targetDir, 'test'), { recursive: true });
fs.cpSync(path.join(extracted, 'lib'), path.join(targetDir, 'lib'), { recursive: true });
fs.copyFileSync(path.join(extracted, 'package.json'), path.join(targetDir, 'package.json'));

if (process.env.SKIP_PREPARE_COMPAT !== '1') {
  run(process.execPath, [path.join(scriptDir, 'prepare-upstream-compat.mjs')], {
    cwd: repoRoot,
    env: process.env,
  });
}

let repoPath = upstreamRepo.replace(/^https:\/\/github\.com\//, '');
repoPath = repoPath.replace(/\.git$/, '');

let commitSha;
try {
  const commitResponse = await fetch(
    `https://api.github.com/repos/${repoPath}/commits/${upstreamRef}`,
  );
  if (!commitResponse.ok) {
    throw new Error(
      `Failed to fetch commit for ${upstreamRepo}@${upstreamRef}: ${commitResponse.status}`,
    );
  }
  commitSha = (await commitResponse.json()).sha;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

fs.writeFileSync(
  path.join(targetDir, 'SOURCE.json'),
  `${JSON.stringify({ repo: upstreamRepo, ref: upstreamRef, commit: commitSha }, null, 2)}\n`,
);

console.log(
  `Synced upstream PostCSS lib/test from ${upstreamRepo}@${upstreamRef} (${commitSha}) into ${targetDir}`,
);
