import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import * as publicApi from '../src/index.ts';

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

function npmPackFiles(cwd: string): string[] {
  const isWindows = process.platform === 'win32';
  const npm = isWindows ? 'npm.cmd' : 'npm';
  const output = execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd,
    encoding: 'utf8',
    // .cmd shims require a shell on Windows; execFile cannot run them directly.
    shell: isWindows,
  });
  const jsonStart = output.indexOf('[');
  const payload = jsonStart >= 0 ? output.slice(jsonStart) : output;
  const [{ files }] = JSON.parse(payload) as Array<{ files: Array<{ path: string }> }>;
  return files.map((file) => file.path);
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

test('@postcss-go/core has no production PostCSS dependency', () => {
  const pkg = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  for (const dependencies of [
    pkg.dependencies ?? {},
    pkg.optionalDependencies ?? {},
    pkg.peerDependencies ?? {},
  ]) {
    expect(dependencies).not.toHaveProperty('postcss');
    expect(dependencies).not.toHaveProperty('postcss-load-config');
    expect(dependencies).not.toHaveProperty('postcss-reporter');
  }
});

test('@postcss-go/core package contains only the JavaScript CLI launcher', () => {
  const files = npmPackFiles(packageRoot);
  expect(files).toContain('bin/postcss-go.js');
  expect(files).not.toContain('bin/postcss-go');
  expect(files).not.toContain('bin/postcss-go.exe');
});

test('@postcss-go/core does not expose native implementation internals', () => {
  for (const name of [
    'createDefaultAsyncService',
    'createNativeService',
    'getDefaultAsyncBackendCapabilities',
    'isNativeAsyncBridgeAvailable',
    'NativePostcssGoService',
    'encodeAst',
    'decodeAst',
    'hydrateAst',
    'serializeAst',
    'postcssApi',
    'parseCliArgs',
    'runCLI',
    'getPollInterval',
    'usePolling',
    'createDependencyGraph',
  ]) {
    expect(publicApi).not.toHaveProperty(name);
  }
});

test('host platform package contains the native addon', () => {
  const tuple = hostTuple();
  const platformPkgRoot = resolve(repoRoot, 'npm/postcss-go', tuple);
  const addonName = `postcss-go.${tuple}.node`;
  const addonPath = resolve(platformPkgRoot, addonName);

  if (!existsSync(addonPath)) {
    expect.fail(`native addon missing at ${addonPath}; expected on ${tuple}`);
  }

  expect(npmPackFiles(platformPkgRoot)).toContain(addonName);

  if (process.platform === 'darwin') {
    const symbols = execFileSync('nm', ['-gU', addonPath], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/).at(-1))
      .sort();
    expect(symbols).toEqual(['_napi_register_module_v1', '_node_api_module_get_api_version_v1']);
  } else if (process.platform === 'linux') {
    const symbols = execFileSync('nm', ['-D', '--defined-only', addonPath], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/).at(-1))
      .sort();
    expect(symbols).toEqual(['napi_register_module_v1', 'node_api_module_get_api_version_v1']);
  }
});
