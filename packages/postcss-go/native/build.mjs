/**
 * Builds the Go c-archive and the Node-API addon used for the sync binary bridge.
 *
 *   node packages/postcss-go/native/build.mjs
 *
 * Failure is non-fatal: the stdio JSON-RPC bridge remains the fallback.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const outDir = resolve(here, 'go-out');
const prebuildDir = resolve(here, 'prebuilds', `${process.platform}-${process.arch}`);
const prebuiltAddon = resolve(prebuildDir, 'postcss_go.node');
const require = createRequire(import.meta.url);

mkdirSync(outDir, { recursive: true });
mkdirSync(prebuildDir, { recursive: true });
rmSync(prebuiltAddon, { force: true });

function run(command, args, options = {}) {
  return spawnSync(command, args, { stdio: 'inherit', ...options });
}

/** Resolve Node-API headers for clangd (prefer the npm package over node-gyp cache). */
function resolveNodeInclude() {
  try {
    const dir = require('node-api-headers').include_dir;
    if (existsSync(join(dir, 'node_api.h'))) return dir;
  } catch {
    // fall through
  }
  const version = process.versions.node;
  return [
    join(homedir(), 'Library/Caches/node-gyp', version, 'include/node'),
    join(homedir(), '.cache/node-gyp', version, 'include/node'),
  ].find((dir) => existsSync(join(dir, 'node_api.h')));
}

/** Write clangd/IDE flags so addon.c can resolve node_api.h without node-gyp. */
function writeCompileFlags() {
  const nodeInclude = resolveNodeInclude();
  if (!nodeInclude) return;

  const flags = ['-std=c11', '-I.', `-I${nodeInclude}`, '-DNAPI_VERSION=8'];
  writeFileSync(resolve(here, 'compile_flags.txt'), `${flags.join('\n')}\n`);
  writeFileSync(
    resolve(here, 'compile_commands.json'),
    `${JSON.stringify(
      [
        {
          directory: here,
          file: resolve(here, 'addon.c'),
          arguments: ['clang', ...flags, '-c', 'addon.c'],
        },
      ],
      null,
      2,
    )}\n`,
  );
}

writeCompileFlags();

const archive = run(
  'go',
  ['build', '-buildmode=c-archive', '-o', resolve(outDir, 'libpostcssgo.a'), './cmd/native'],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      CGO_ENABLED: '1',
      GOFLAGS: process.env.GOFLAGS ? `${process.env.GOFLAGS} -mod=mod` : '-mod=mod',
    },
  },
);

if (archive.status !== 0) {
  console.warn('postcss-go: native c-archive build failed; stdio bridge remains available');
  process.exit(0);
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const addon = run(npx, ['--yes', 'node-gyp', 'rebuild'], {
  cwd: here,
  // .cmd shims require a shell on Windows; spawn cannot run them directly.
  shell: process.platform === 'win32',
});
if (addon.status !== 0) {
  console.warn('postcss-go: native addon build failed; stdio bridge remains available');
  process.exit(0);
}

copyFileSync(resolve(here, 'build/Release/postcss_go.node'), prebuiltAddon);
