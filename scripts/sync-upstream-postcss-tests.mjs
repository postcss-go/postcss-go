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
const defaultTargetDir = path.join(repoRoot, 'vendor', 'postcss');
const targetDir = process.env.TARGET_DIR ?? defaultTargetDir;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postcss-go-sync-'));
const fetchTimeoutMs = 30_000;

const harnessDependencies = [
  'nanoid',
  'picocolors',
  'source-map-js',
  'concat-with-sourcemaps',
  'nanodelay',
  'nanospy',
  'postcss-parser-tests',
  'strip-ansi',
  'ts-node',
  'uvu',
];

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

async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(fetchTimeoutMs) });
      if (
        response.ok ||
        (response.status < 500 && response.status !== 408 && response.status !== 429)
      ) {
        return response;
      }
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function download(url, dest) {
  const response = await fetchWithRetry(url);
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

// Keep the compatibility harness on the exact helper versions used by the
// vendored upstream suite. A detached TARGET_DIR is used by the drift check,
// so only update the workspace manifest during a real sync.
if (path.resolve(targetDir) === path.resolve(defaultTargetDir)) {
  const upstreamPackage = JSON.parse(fs.readFileSync(path.join(extracted, 'package.json'), 'utf8'));
  const compatPackagePath = path.join(repoRoot, 'packages', 'postcss-compat', 'package.json');
  const compatPackage = JSON.parse(fs.readFileSync(compatPackagePath, 'utf8'));

  for (const name of harnessDependencies) {
    const version = upstreamPackage.dependencies?.[name] ?? upstreamPackage.devDependencies?.[name];
    if (!version) continue;
    if (name in (compatPackage.dependencies ?? {})) {
      compatPackage.dependencies[name] = version;
    } else if (name in (compatPackage.devDependencies ?? {})) {
      compatPackage.devDependencies[name] = version;
    }
  }

  fs.writeFileSync(compatPackagePath, `${JSON.stringify(compatPackage, null, 2)}\n`);
}

if (process.env.SKIP_PREPARE_COMPAT !== '1') {
  run(process.execPath, [path.join(scriptDir, 'prepare-upstream-compat.mjs')], {
    cwd: repoRoot,
    env: process.env,
  });
}

let repoPath = upstreamRepo.replace(/^https:\/\/github\.com\//, '');
repoPath = repoPath.replace(/\.git$/, '');

let commitSha;
if (/^[0-9a-f]{40}$/i.test(upstreamRef)) {
  commitSha = upstreamRef;
} else {
  try {
    const commitResponse = await fetchWithRetry(
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
}

fs.writeFileSync(
  path.join(targetDir, 'SOURCE.json'),
  `${JSON.stringify({ repo: upstreamRepo, ref: upstreamRef, commit: commitSha }, null, 2)}\n`,
);

console.log(
  `Synced upstream PostCSS lib/test from ${upstreamRepo}@${upstreamRef} (${commitSha}) into ${targetDir}`,
);
