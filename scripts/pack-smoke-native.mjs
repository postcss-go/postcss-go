#!/usr/bin/env node

/**
 * Packs core and the current native platform package, installs the tarballs
 * in a clean project, and runs the native public-API smoke test. The private
 * shared workspace package must already be bundled into core.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = resolve(import.meta.dirname, '..');
const isWindows = process.platform === 'win32';
const pnpm = isWindows ? 'pnpm.cmd' : 'pnpm';
const npm = isWindows ? 'npm.cmd' : 'npm';

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: isWindows,
    ...options,
  });
}

function isMusl() {
  if (process.platform !== 'linux') return false;
  try {
    return readFileSync('/usr/bin/ldd', 'utf8').includes('musl');
  } catch {
    return false;
  }
}

function tuple() {
  if (process.platform === 'darwin') return `darwin-${process.arch}`;
  if (process.platform === 'win32') return `win32-${process.arch}-msvc`;
  if (process.platform === 'linux') {
    if (isMusl()) {
      throw new Error(
        'postcss-go: native Node addons are unavailable on musl until Go fixes golang/go#54805',
      );
    }
    return `linux-${process.arch}-gnu`;
  }
  throw new Error(`unsupported native platform ${process.platform}-${process.arch}`);
}

const staging = mkdtempSync(resolve(tmpdir(), 'postcss-go-native-pack-'));
try {
  const directories = [
    resolve(repoRoot, 'packages/postcss-go'),
    resolve(repoRoot, 'npm/postcss-go', tuple()),
  ];
  for (const directory of directories) {
    run(pnpm, ['--dir', directory, 'pack', '--pack-destination', staging]);
  }

  const tarballs = directories.map((directory) => {
    const pkg = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
    return resolve(staging, `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`);
  });

  writeFileSync(
    resolve(staging, 'package.json'),
    `${JSON.stringify({ name: 'native-pack-staging', private: true }, null, 2)}\n`,
  );
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs], {
    cwd: staging,
  });

  // npm installs into staging/node_modules; run the smoke there so package-name
  // imports exercise the exact packed dependency layout.
  const installedEntry = pathToFileURL(
    resolve(staging, 'node_modules/@postcss-go/core/dist/index.js'),
  ).href;
  run(process.execPath, [resolve(repoRoot, 'scripts/smoke-native-package.mjs'), installedEntry], {
    cwd: staging,
  });
} finally {
  rmSync(staging, { recursive: true, force: true });
}
