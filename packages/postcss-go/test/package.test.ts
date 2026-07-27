import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');

function isMusl(): boolean {
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

function hostTuple(): string {
  const { platform, arch } = process;
  if (platform === 'darwin') return `darwin-${arch}`;
  if (platform === 'win32') return `win32-${arch}-msvc`;
  if (platform === 'linux') return `linux-${arch}-${isMusl() ? 'musl' : 'gnu'}`;
  throw new Error(`unsupported host platform ${platform}-${arch}`);
}

test('@postcss-go/core lists platform packages as optionalDependencies', () => {
  const pkg = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
    optionalDependencies?: Record<string, string>;
    files?: string[];
  };
  expect(pkg.optionalDependencies).toMatchObject({
    '@postcss-go/native-darwin-arm64': 'workspace:*',
    '@postcss-go/native-darwin-x64': 'workspace:*',
    '@postcss-go/native-linux-arm64-gnu': 'workspace:*',
    '@postcss-go/native-linux-arm64-musl': 'workspace:*',
    '@postcss-go/native-linux-x64-gnu': 'workspace:*',
    '@postcss-go/native-linux-x64-musl': 'workspace:*',
    '@postcss-go/native-win32-arm64-msvc': 'workspace:*',
    '@postcss-go/native-win32-x64-msvc': 'workspace:*',
  });
  expect(pkg.files ?? []).not.toContain('native/prebuilds/**/*.node');
});

test('host platform package contains the native addon', () => {
  const tuple = hostTuple();
  const platformPkgRoot = resolve(repoRoot, 'npm/postcss-go', tuple);
  const addonName = `postcss-go.${tuple}.node`;
  expect(existsSync(resolve(platformPkgRoot, addonName))).toBe(true);

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const output = execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: platformPkgRoot,
    encoding: 'utf8',
  });
  const [{ files }] = JSON.parse(output) as Array<{ files: Array<{ path: string }> }>;
  expect(files.map((file) => file.path)).toContain(addonName);
});
