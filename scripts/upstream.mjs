#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = path.join(repoRoot, 'vendor', 'postcss');
const vendorLib = path.join(vendorDir, 'lib');
const overridesDir = path.join(repoRoot, 'packages', 'postcss-compat', 'overrides');
const goDistDir = path.join(repoRoot, 'packages', 'postcss-compat', 'dist');
const bridgeClient = path.join(repoRoot, 'packages', 'postcss-compat', 'bridge-client.cjs');
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

const tempDirs = [];

function cleanup() {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

function makeTemp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function fail(...lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result;
}

function requireVendorSnapshot(dir = vendorDir) {
  if (!fs.existsSync(path.join(dir, 'test')) || !fs.existsSync(path.join(dir, 'lib'))) {
    fail(`Missing vendored upstream PostCSS snapshot at ${dir}`, 'Run `pnpm sync:upstream` first.');
  }
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

function collectFiles(dir, base = dir, files = new Map()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, base, files);
    } else {
      files.set(path.relative(base, full), fs.readFileSync(full));
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

function applyOverride(targetLib, file) {
  if (!file.endsWith('.js')) return;
  fs.copyFileSync(file, path.join(targetLib, path.basename(file)));
}

function applyOverridesFrom(targetLib, dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (fs.statSync(file).isFile()) applyOverride(targetLib, file);
  }
}

function prepare() {
  const targetLib = process.env.POSTCSS_COMPAT_TARGET_LIB ?? vendorLib;
  const mode = process.env.POSTCSS_COMPAT_MODE ?? 'upstream';

  if (!fs.existsSync(targetLib) || !fs.statSync(targetLib).isDirectory()) {
    fail(`Missing vendored upstream lib at ${targetLib}`, 'Run `pnpm sync:upstream` first.');
  }

  // Go overrides must only land on a temp copy. Writing them into
  // vendor/postcss/lib permanently breaks POSTCSS_COMPAT_MODE=upstream.
  if (
    mode === 'go' &&
    path.resolve(targetLib) === path.resolve(vendorLib) &&
    process.env.POSTCSS_COMPAT_ALLOW_VENDOR_WRITE !== '1'
  ) {
    fail(
      'Refusing to apply Go overrides directly to vendor/postcss/lib.',
      'Use `pnpm test:upstream:go` (temp copy) or set POSTCSS_COMPAT_TARGET_LIB.',
    );
  }

  switch (mode) {
    case 'upstream':
      applyOverridesFrom(targetLib, path.join(overridesDir, 'upstream'));
      break;
    case 'go': {
      if (!fs.existsSync(goDistDir) || !fs.statSync(goDistDir).isDirectory()) {
        fail(
          `Missing Go compat build output at ${goDistDir}`,
          'Run `pnpm --filter @postcss-go/compat build` first.',
        );
      }
      applyOverridesFrom(targetLib, goDistDir);
      break;
    }
    default:
      fail(`Unsupported POSTCSS_COMPAT_MODE: ${mode} (expected upstream or go)`);
  }

  console.log(`Prepared upstream compat lib (mode=${mode})`);
}

async function sync(args, options = {}) {
  const upstreamRepo =
    options.repo ?? process.env.UPSTREAM_REPO ?? 'https://github.com/postcss/postcss';
  const upstreamRef = args[0] ?? options.ref ?? process.env.UPSTREAM_REF ?? 'main';
  const targetDir = options.targetDir ?? process.env.TARGET_DIR ?? vendorDir;
  const skipPrepare = options.skipPrepare ?? process.env.SKIP_PREPARE_COMPAT === '1';
  const tmpDir = makeTemp('postcss-go-sync-');
  const archiveUrl = `${upstreamRepo.replace(/\/$/, '')}/archive/${upstreamRef}.tar.gz`;
  const archivePath = path.join(tmpDir, 'postcss.tar.gz');

  try {
    const response = await fetchWithRetry(archiveUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to download ${archiveUrl}: ${response.status} ${response.statusText}`,
      );
    }
    fs.writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    fail(error instanceof Error ? error.message : error);
  }

  run('tar', ['-xzf', archivePath, '-C', tmpDir]);

  fs.mkdirSync(targetDir, { recursive: true });
  fs.rmSync(path.join(targetDir, 'test'), { recursive: true, force: true });
  fs.rmSync(path.join(targetDir, 'lib'), { recursive: true, force: true });

  const sourceDir = fs
    .readdirSync(tmpDir, { withFileTypes: true })
    .find((entry) => entry.isDirectory())?.name;

  if (!sourceDir) fail('Unable to find extracted PostCSS archive directory.');

  const extracted = path.join(tmpDir, sourceDir);
  fs.cpSync(path.join(extracted, 'test'), path.join(targetDir, 'test'), { recursive: true });
  fs.cpSync(path.join(extracted, 'lib'), path.join(targetDir, 'lib'), { recursive: true });
  fs.copyFileSync(path.join(extracted, 'package.json'), path.join(targetDir, 'package.json'));

  // Keep the compatibility harness on the exact helper versions used by the
  // vendored upstream suite. A detached TARGET_DIR is used by the drift check,
  // so only update the workspace manifest during a real sync.
  if (path.resolve(targetDir) === path.resolve(vendorDir)) {
    const upstreamPackage = JSON.parse(
      fs.readFileSync(path.join(extracted, 'package.json'), 'utf8'),
    );
    const compatPackagePath = path.join(repoRoot, 'packages', 'postcss-compat', 'package.json');
    const compatPackage = JSON.parse(fs.readFileSync(compatPackagePath, 'utf8'));

    for (const name of harnessDependencies) {
      const version =
        upstreamPackage.dependencies?.[name] ?? upstreamPackage.devDependencies?.[name];
      if (!version) continue;
      if (name in (compatPackage.dependencies ?? {})) {
        compatPackage.dependencies[name] = version;
      } else if (name in (compatPackage.devDependencies ?? {})) {
        compatPackage.devDependencies[name] = version;
      }
    }

    fs.writeFileSync(compatPackagePath, `${JSON.stringify(compatPackage, null, 2)}\n`);
  }

  if (!skipPrepare) prepare();

  let repoPath = upstreamRepo.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
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
      fail(error instanceof Error ? error.message : error);
    }
  }

  fs.writeFileSync(
    path.join(targetDir, 'SOURCE.json'),
    `${JSON.stringify({ repo: upstreamRepo, ref: upstreamRef, commit: commitSha }, null, 2)}\n`,
  );

  console.log(
    `Synced upstream PostCSS lib/test from ${upstreamRepo}@${upstreamRef} (${commitSha}) into ${targetDir}`,
  );
}

async function check(args) {
  requireVendorSnapshot();

  const tmpDir = makeTemp('postcss-go-check-');
  let upstreamRepo = process.env.UPSTREAM_REPO ?? 'https://github.com/postcss/postcss';
  let upstreamRef;
  let preserveSourceJson = false;

  if (args[0]) {
    upstreamRef = args[0];
  } else {
    const sourcePath = path.join(vendorDir, 'SOURCE.json');
    if (!fs.existsSync(sourcePath)) {
      fail(
        `Missing vendored upstream PostCSS source metadata at ${sourcePath}`,
        'Run `pnpm sync:upstream` first.',
      );
    }
    const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    upstreamRepo = source.repo || '';
    upstreamRef = source.commit || source.ref || '';
    preserveSourceJson = true;
  }

  if (!upstreamRepo || !upstreamRef) fail('Unable to determine upstream PostCSS source.');

  await sync([upstreamRef], {
    repo: upstreamRepo,
    targetDir: path.join(tmpDir, 'postcss'),
    skipPrepare: true,
  });

  const actualDir = path.join(tmpDir, 'postcss');
  if (preserveSourceJson) {
    fs.copyFileSync(path.join(vendorDir, 'SOURCE.json'), path.join(actualDir, 'SOURCE.json'));
  }

  const diffs = diffDirs(vendorDir, actualDir);
  if (diffs.length > 0) {
    console.error('Vendored upstream PostCSS snapshot is out of date.');
    console.error('Run `pnpm sync:upstream` and commit the result.');
    const sourcePath = path.join(vendorDir, 'SOURCE.json');
    if (fs.existsSync(sourcePath)) {
      const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
      console.error('Current snapshot:');
      console.error(`  ${source.repo}@${source.ref} (${source.commit})`);
    }
    for (const line of diffs) console.error(line);
    process.exit(1);
  }

  const sourcePath = path.join(vendorDir, 'SOURCE.json');
  if (fs.existsSync(sourcePath)) {
    const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    console.log(`Vendored upstream PostCSS snapshot is in sync (${source.commit}).`);
  } else {
    console.log('Vendored upstream PostCSS snapshot is in sync.');
  }
}

function test() {
  requireVendorSnapshot();

  const mode = process.env.POSTCSS_COMPAT_MODE ?? 'upstream';
  const pattern = process.env.UPSTREAM_TEST_PATTERN ?? '\\.test\\.(ts|js)$';
  const tmpDir = makeTemp('postcss-go-upstream-');
  const env = { ...process.env, POSTCSS_COMPAT_MODE: mode, FORCE_COLOR: '1' };
  delete env.NO_COLOR;

  const compatDir = path.join(tmpDir, 'postcss');
  fs.cpSync(vendorDir, compatDir, { recursive: true });

  process.env.POSTCSS_COMPAT_MODE = mode;
  process.env.POSTCSS_COMPAT_TARGET_LIB = path.join(compatDir, 'lib');
  process.env.POSTCSS_GO_COMPAT_BRIDGE_CLIENT = bridgeClient;
  prepare();

  const uvuArgs = [
    '--dir',
    path.join(repoRoot, 'packages', 'postcss-compat'),
    'exec',
    'uvu',
    '-r',
    path.join(repoRoot, 'packages', 'postcss-compat', 'register.cjs'),
    path.join(compatDir, 'test'),
    pattern,
  ];

  const uvuEnv = { ...env };
  if (mode === 'go') {
    uvuEnv.POSTCSS_GO_COMPAT_BRIDGE_CLIENT = bridgeClient;
    // Overrides run from a temp copy of vendor/postcss/lib and require workspace
    // packages such as @postcss-go/shared; NODE_PATH keeps those resolvable.
    const nodePaths = [
      path.join(repoRoot, 'packages', 'postcss-compat', 'node_modules'),
      path.join(repoRoot, 'node_modules'),
    ];
    uvuEnv.NODE_PATH = uvuEnv.NODE_PATH
      ? [...nodePaths, uvuEnv.NODE_PATH].join(path.delimiter)
      : nodePaths.join(path.delimiter);
  }

  run('pnpm', uvuArgs, { cwd: repoRoot, env: uvuEnv });
}

function generateAstContract() {
  const srcDir = path.join(vendorDir, 'test');
  const outDir = path.join(repoRoot, 'packages', 'postcss-go', 'test', 'upstream-ast-contract');
  const files = [
    'node.test.ts',
    'container.test.ts',
    'rule.test.ts',
    'at-rule.test.ts',
    'declaration.test.ts',
    'comment.test.ts',
    'root.test.ts',
  ];
  const header = `import { test } from 'vitest'
import {
  AtRule,
  Comment,
  Container,
  CssSyntaxError,
  Declaration,
  Document,
  Input,
  Node,
  Result,
  Root,
  Rule,
  Warning,
  fromJSON,
  list,
  parse,
  postcss,
  stringify,
  equal,
  is,
  instance,
  match,
  not,
  ok,
  throws,
  type,
  type AnyNode,
  type Plugin,
} from './helpers.ts'
`;

  function stripLeadingImports(text) {
    const lines = text.split('\n');
    let i = 0;
    const kept = [];
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === '') {
        i += 1;
        continue;
      }
      if (!line.startsWith('import ')) break;
      const start = i;
      while (i < lines.length && !lines[i].includes(' from ')) i += 1;
      if (i < lines.length) i += 1;
      const block = lines.slice(start, i).join('\n');
      if (
        !block.includes("'uvu'") &&
        !block.includes('uvu/assert') &&
        !block.includes('../lib/postcss.js') &&
        !block.includes('../lib/document.js')
      ) {
        kept.push(block);
      }
    }
    while (i < lines.length && lines[i].trim() === '') i += 1;
    return { kept, body: lines.slice(i).join('\n') };
  }

  requireVendorSnapshot();

  for (const name of files) {
    const raw = fs.readFileSync(path.join(srcDir, name), 'utf8');
    const { kept, body: rawBody } = stripLeadingImports(raw);
    let body = rawBody.replace(/\ntest\.run\(\)\s*$/, '\n');

    if (name === 'node.test.ts') {
      body = body.replace(
        /test\('warn\(\) accepts options', \(\) => \{([\s\S]*?)let result = postcss\(\[warner\]\)\.process\('a\{\}'\)/,
        "test('warn() accepts options', async () => {$1let result = await postcss([warner]).process('a{}')",
      );
    }
    if (name === 'root.test.ts') {
      body = body.replace(
        /test\('generates result with map', \(\) => \{([\s\S]*?)let result = root\.toResult\(\{ map: true \}\)/,
        "test('generates result with map', async () => {$1let result = await root.toResult({ map: true })",
      );
    }

    const parts = [header.trimEnd(), ''];
    if (kept.length) parts.push(...kept, '');
    parts.push(body.endsWith('\n') ? body : `${body}\n`);
    fs.writeFileSync(path.join(outDir, name), parts.join('\n'));
    console.log(`wrote ${name}`);
  }

  console.log('Preserved manually: helpers.ts, document.test.ts, fromJSON.test.ts');
}

const commands = {
  sync,
  check,
  prepare,
  test,
  'generate-ast-contract': generateAstContract,
};

function usage(exitCode = 1) {
  console.log(`Usage: node ./scripts/upstream.mjs <command> [args]

Commands:
  sync [ref]                 Vendor PostCSS lib/test from upstream
  check [ref]                Verify the vendored snapshot matches upstream
  prepare                    Apply compat overrides to vendor/postcss/lib
  test                       Run the vendored PostCSS test suite
  generate-ast-contract      Regenerate owned AST contract tests from vendor/postcss/test
`);
  process.exit(exitCode);
}

const [command, ...args] = process.argv.slice(2);
if (!command || command === '-h' || command === '--help') usage(command ? 0 : 1);
if (!(command in commands)) {
  console.error(`Unknown command: ${command}\n`);
  usage(1);
}

await commands[command](args);
