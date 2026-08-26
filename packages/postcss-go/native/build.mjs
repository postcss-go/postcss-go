/**
 * Builds the Go library and the Node-API addon, then places the host native
 * files into the matching `@postcss-go/native-<tuple>` package so the runtime
 * loader resolves the same path in development and production. Windows uses
 * c-shared because MSVC cannot consume Go's GNU archive and the shared Go
 * runtime remains usable across multiple Node Worker environments.
 *
 *   node packages/postcss-go/native/build.mjs
 *
 * Native is the only Node backend, so build failures are fatal.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const outDir = resolve(here, 'go-out');
const require = createRequire(import.meta.url);
const deploymentTarget = process.env.MACOSX_DEPLOYMENT_TARGET ?? '11.0';
const deploymentEnv =
  process.platform === 'darwin'
    ? {
        MACOSX_DEPLOYMENT_TARGET: deploymentTarget,
        CGO_CFLAGS:
          `${process.env.CGO_CFLAGS ?? ''} -mmacosx-version-min=${deploymentTarget}`.trim(),
        CGO_LDFLAGS:
          `${process.env.CGO_LDFLAGS ?? ''} -mmacosx-version-min=${deploymentTarget}`.trim(),
      }
    : {};

/** Go requires GOCACHE or LocalAppData; Turbo strict mode may strip the latter on Windows. */
function withGoCache(env) {
  if (env.GOCACHE || env.LOCALAPPDATA || env.LocalAppData) return env;
  return { ...env, GOCACHE: join(homedir(), '.cache', 'go-build') };
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { stdio: 'inherit', ...options });
}

/** musl detection on Linux (glibc and musl .node files are not interchangeable). */
function isMusl() {
  if (process.platform !== 'linux') return false;
  try {
    if (readFileSync('/usr/bin/ldd', 'utf8').includes('musl')) return true;
  } catch {
    // fall through
  }
  try {
    return execFileSync('ldd', ['--version'], { encoding: 'utf8' }).includes('musl');
  } catch {
    return false;
  }
}

function hostTuple() {
  const { platform, arch } = process;
  if (platform === 'darwin') return `darwin-${arch}`;
  if (platform === 'win32') return `win32-${arch}-msvc`;
  if (platform === 'linux') {
    if (isMusl()) {
      throw new Error(
        'postcss-go: native Node addons are unavailable on musl until Go fixes golang/go#54805',
      );
    }
    return `linux-${arch}-gnu`;
  }
  throw new Error(`unsupported host platform ${platform}-${arch}`);
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

const tuple = hostTuple();
mkdirSync(outDir, { recursive: true });
writeCompileFlags();

const windowsDynamic = process.platform === 'win32';
const shared = windowsDynamic;
const goLibraryName = windowsDynamic ? 'libpostcssgo.dll' : 'libpostcssgo.a';
const goLibrary = resolve(outDir, goLibraryName);

const archive = run(
  'go',
  [
    'build',
    '-buildvcs=false',
    '-tags=nativeaddon',
    `-buildmode=${shared ? 'c-shared' : 'c-archive'}`,
    '-o',
    goLibrary,
    './internal/nativeaddon/cabi',
  ],
  {
    cwd: repoRoot,
    env: withGoCache({
      ...process.env,
      ...deploymentEnv,
      CGO_ENABLED: '1',
      GOFLAGS: process.env.GOFLAGS ? `${process.env.GOFLAGS} -mod=mod` : '-mod=mod',
    }),
  },
);

if (archive.status !== 0) {
  console.error(`postcss-go: native ${shared ? 'c-shared' : 'c-archive'} build failed`);
  process.exit(archive.status ?? 1);
}

const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js');
const addon = run(process.execPath, [nodeGyp, 'rebuild'], {
  cwd: here,
  env: {
    ...process.env,
    ...deploymentEnv,
    GYP_DEFINES:
      `${process.env.GYP_DEFINES ?? ''} postcss_go_dynamic=${windowsDynamic ? 1 : 0}`.trim(),
  },
});
if (addon.status !== 0) {
  console.error('postcss-go: native addon build failed');
  process.exit(addon.status ?? 1);
}

const builtAddon = resolve(here, 'build/Release/postcss_go.node');
if (!existsSync(builtAddon)) {
  console.error('postcss-go: native addon output missing');
  process.exit(1);
}

const platformPkgDir = resolve(repoRoot, 'npm/postcss-go', tuple);
const placedAddon = resolve(platformPkgDir, `postcss-go.${tuple}.node`);
const placedDynamicLibrary = resolve(platformPkgDir, 'libpostcssgo.dll');
mkdirSync(platformPkgDir, { recursive: true });
rmSync(placedAddon, { force: true });
rmSync(placedDynamicLibrary, { force: true });
copyFileSync(builtAddon, placedAddon);
if (windowsDynamic) copyFileSync(goLibrary, placedDynamicLibrary);
console.log(`postcss-go: placed native addon at ${placedAddon}`);
if (windowsDynamic) console.log(`postcss-go: placed native companion at ${placedDynamicLibrary}`);
