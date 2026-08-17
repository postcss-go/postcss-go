import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import * as publicApi from '../src/index.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');
const sharedRoot = resolve(repoRoot, 'packages/shared');
const isWindows = process.platform === 'win32';
const npmBin = isWindows ? 'npm.cmd' : 'npm';

function npm(cwd: string, args: string[]): string {
  return execFileSync(npmBin, args, {
    cwd,
    encoding: 'utf8',
    // .cmd shims require a shell on Windows; execFile cannot run them directly.
    shell: isWindows,
  });
}

function npmPackFilename(cwd: string): string {
  const output = npm(cwd, ['pack', '--ignore-scripts']).trim();
  const filename = output.split(/\r?\n/).at(-1)?.trim();
  if (!filename?.endsWith('.tgz')) {
    throw new Error(`npm pack did not return a tarball name from ${cwd}: ${output}`);
  }
  return filename;
}

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
  const output = npm(cwd, ['pack', '--dry-run', '--json', '--ignore-scripts']);
  const jsonStart = output.indexOf('[');
  const payload = jsonStart >= 0 ? output.slice(jsonStart) : output;
  const [{ files }] = JSON.parse(payload) as Array<{ files: Array<{ path: string }> }>;
  return files.map((file) => file.path);
}

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

function assertPackageAbsent(cwd: string, name: string): void {
  let output: string;
  let status = 0;
  try {
    output = npm(cwd, ['ls', name, '--all']);
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    status = failure.status ?? 1;
    output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
  }
  expect(output, `npm ls ${name}`).toMatch(/\(empty\)/);
  expect(status, `npm ls ${name} exit code`).not.toBe(0);
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
    '@postcss-go/native-linux-x64-gnu': 'workspace:*',
    '@postcss-go/native-win32-arm64-msvc': 'workspace:*',
    '@postcss-go/native-win32-x64-msvc': 'workspace:*',
  });
  expect(pkg.optionalDependencies).not.toHaveProperty('@postcss-go/native-linux-arm64-musl');
  expect(pkg.optionalDependencies).not.toHaveProperty('@postcss-go/native-linux-x64-musl');
  expect(pkg.files ?? []).not.toContain('native/prebuilds/**/*.node');
});

test('release builds JavaScript and WASM without rebuilding validated native addons', () => {
  const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  expect(rootPackage.scripts['build:release']).toContain('@postcss-go/core build:js');
  expect(rootPackage.scripts['build:release']).toContain('@postcss-go/core build:wasm');
  expect(rootPackage.scripts['build:release']).not.toContain('build:native');
  expect(rootPackage.scripts.release).toBe('node ./scripts/release.mjs');

  const localRelease = readFileSync(resolve(repoRoot, 'scripts/release.mjs'), 'utf8');
  expect(localRelease).toContain("'snapshot'");
  expect(localRelease).toContain("'build:release'");
  expect(localRelease).toContain("'verify'");
  expect(localRelease).toContain("'changeset:publish'");

  const workflow = readFileSync(resolve(repoRoot, '.github/workflows/release.yml'), 'utf8');
  expect(workflow).toContain('uses: actions/setup-go@');
  expect(workflow).toContain('pnpm build:release');
  expect(workflow).toContain('check-native-artifacts.mjs snapshot');
  expect(workflow).toContain('check-native-artifacts.mjs verify');
  expect(workflow).toContain('publish: pnpm changeset:publish');
  expect(workflow).not.toContain('publish: pnpm release');
});

test('@postcss-go/shared stays private and is bundled into core', () => {
  const sharedPackage = JSON.parse(readFileSync(resolve(sharedRoot, 'package.json'), 'utf8')) as {
    name: string;
    private?: boolean;
  };
  expect(sharedPackage.name).toBe('@postcss-go/shared');
  expect(sharedPackage.private).toBe(true);

  const corePackage = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  expect(corePackage.dependencies).not.toHaveProperty('@postcss-go/shared');
  expect(corePackage.devDependencies).toHaveProperty('@postcss-go/shared', 'workspace:*');
  expect(corePackage.scripts?.['build:js']).toContain('pnpm --filter @postcss-go/shared build');

  const changesets = JSON.parse(
    readFileSync(resolve(repoRoot, '.changeset/config.json'), 'utf8'),
  ) as {
    fixed: string[][];
  };
  const coreReleaseGroup = changesets.fixed.find((group) => group.includes('@postcss-go/core'));
  expect(coreReleaseGroup).not.toContain('@postcss-go/shared');

  expect(npmPackFiles(packageRoot)).toEqual(
    expect.arrayContaining([
      'dist/shared/dist/map-options.js',
      'dist/shared/dist/map-options.d.ts',
      'dist/shared/dist/map-path.js',
      'dist/shared/dist/map-path.d.ts',
    ]),
  );
  for (const path of filesBelow(resolve(packageRoot, 'dist'))) {
    if (!/\.(?:js|d\.ts)$/.test(path)) continue;
    expect(readFileSync(path, 'utf8'), path).not.toContain('@postcss-go/shared');
  }
});

test('Windows links the system libraries required by a Go c-archive', () => {
  const binding = readFileSync(resolve(packageRoot, 'native/binding.gyp'), 'utf8');
  expect(binding).toContain(`"OS=='win'"`);
  for (const library of [
    'ntdll.lib',
    'ws2_32.lib',
    'winmm.lib',
    'userenv.lib',
    'bcrypt.lib',
    'advapi32.lib',
  ]) {
    expect(binding).toContain(`"${library}"`);
  }
  expect(binding).not.toMatch(/"-l(?:ntdll|ws2_32|winmm)"/);
});

test('companion-library packages keep their runtime library beside the addon', () => {
  const binding = readFileSync(resolve(packageRoot, 'native/binding.gyp'), 'utf8');
  for (const arch of ['arm64', 'x64']) {
    const windowsPackage = JSON.parse(
      readFileSync(resolve(repoRoot, `npm/postcss-go/win32-${arch}-msvc/package.json`), 'utf8'),
    ) as { files: string[] };
    expect(windowsPackage.files).toEqual([
      `postcss-go.win32-${arch}-msvc.node`,
      'libpostcssgo.dll',
    ]);
  }
  expect(binding).toContain('POSTCSS_GO_DYNAMIC_LIBRARY=1');

  const workflow = readFileSync(resolve(repoRoot, '.github/workflows/native.yml'), 'utf8');
  expect(workflow).toContain('npm/postcss-go/${{ matrix.tuple }}/libpostcssgo.dll');
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
  expect(files).toContain('README.md');
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
    // CLI / dispatch / browser internals stay off the main Node entry.
    'createGoEngine',
    'processWithGoEngine',
    'runPluginChain',
    'getEffectiveMapOption',
    'dispatchProcess',
    'dispatchProcessSync',
    'dispatchProcessDto',
    'dispatchParse',
    'dispatchParseSync',
    'dispatchParseAst',
    'dispatchStringify',
    'dispatchStringifySync',
    'dispatchStringifyResult',
    'dispatchNoWork',
    'dispatchNoWorkSync',
    'prepareDispatchOptions',
    'BrowserPostcssGoService',
    'isPathSpecifier',
    // Map-pipeline and hydration helpers stay off the main Node entry.
    'hydrateInput',
    'hydrateResultMessages',
    'asProcessRoot',
    'RuntimePlugin',
    'applyMapAnnotation',
    'applyMapAnnotationAsync',
    'isExternalSourceMap',
    'isSourceMapEnabled',
    'mapDefersInlineMode',
    'materializePreviousMap',
    'normalizeProcessOptions',
    'getMapfile',
    'joinMapAnnotationPath',
    'toSourceMapPath',
  ]) {
    expect(publicApi).not.toHaveProperty(name);
  }
});

test('@postcss-go/core browser entry exports BrowserPostcssGoService and createBrowserProcessor', async () => {
  const browserApi = await import('../src/wasm/index.ts');
  expect(browserApi).toHaveProperty('BrowserPostcssGoService');
  expect(browserApi).toHaveProperty('createBrowserProcessor');
  expect(browserApi).toHaveProperty('WasmWorkerError');
  expect(browserApi).toHaveProperty('CssSyntaxError');
  expect(browserApi).toHaveProperty('errorFromWasmDto');
  expect(browserApi).not.toHaveProperty('UnsupportedServiceError');
  expect(browserApi).not.toHaveProperty('WASM_WORKER_BACKEND_CAPABILITIES');
  expect(browserApi).not.toHaveProperty('PostcssGoService');
});

test('@postcss-go/core wasm entry re-exports the browser API and declares asset subpaths', async () => {
  const wasmApi = await import('../src/wasm/index.ts');
  expect(wasmApi).toHaveProperty('createBrowserProcessor');
  expect(wasmApi).toHaveProperty('BrowserPostcssGoService');
  expect(wasmApi).toHaveProperty('WasmWorkerError');

  const pkg = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
    exports: Record<string, unknown>;
    scripts: Record<string, string>;
  };
  expect(pkg.exports).toMatchObject({
    './browser': {
      types: './dist/wasm.d.ts',
      default: './dist/wasm.js',
    },
    './wasm': {
      types: './dist/wasm.d.ts',
      default: './dist/wasm.js',
    },
    './wasm/worker': { default: './dist/wasm/worker.js' },
    './wasm/postcss-go.wasm': { default: './dist/wasm/postcss-go.wasm' },
    './wasm/wasm_exec.js': { default: './dist/wasm/wasm_exec.js' },
  });
  expect(pkg.scripts['build:wasm']).toContain('build-wasm.mjs');
  expect(npmPackFiles(packageRoot)).toEqual(
    expect.arrayContaining([
      'dist/wasm.js',
      'dist/wasm/worker.js',
      'dist/wasm/postcss-go.wasm',
      'dist/wasm/wasm_exec.js',
    ]),
  );
});
test('host platform package contains the native addon', () => {
  const tuple = hostTuple();
  const platformPkgRoot = resolve(repoRoot, 'npm/postcss-go', tuple);
  const addonName = `postcss-go.${tuple}.node`;
  const addonPath = resolve(platformPkgRoot, addonName);

  if (!existsSync(addonPath)) {
    expect.fail(`native addon missing at ${addonPath}; expected on ${tuple}`);
  }

  const packedFiles = npmPackFiles(platformPkgRoot);
  expect(packedFiles).toContain(addonName);
  if (tuple.startsWith('win32-')) expect(packedFiles).toContain('libpostcssgo.dll');

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

test('clean packed installation has no PostCSS packages in the dependency tree', () => {
  expect(existsSync(resolve(sharedRoot, 'dist/index.js'))).toBe(true);
  expect(existsSync(resolve(packageRoot, 'dist/index.js'))).toBe(true);

  const staging = mkdtempSync(resolve(tmpdir(), 'postcss-go-pack-'));
  try {
    const coreStage = resolve(staging, 'core');
    mkdirSync(coreStage);
    cpSync(resolve(packageRoot, 'dist'), resolve(coreStage, 'dist'), { recursive: true });
    cpSync(resolve(packageRoot, 'bin'), resolve(coreStage, 'bin'), { recursive: true });

    const corePkg = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      [key: string]: unknown;
    };
    // Workspace optional native packages are published separately; omit them here so the
    // install resolves without workspace protocol and still proves the JS production tree.
    delete corePkg.optionalDependencies;
    delete corePkg.devDependencies;
    writeFileSync(resolve(coreStage, 'package.json'), `${JSON.stringify(corePkg, null, 2)}\n`);

    const corePackName = npmPackFilename(coreStage);
    const coreTarball = resolve(staging, corePackName);
    cpSync(resolve(coreStage, corePackName), coreTarball);

    const consumer = resolve(staging, 'consumer');
    mkdirSync(consumer);
    writeFileSync(
      resolve(consumer, 'package.json'),
      `${JSON.stringify(
        {
          name: 'postcss-go-pack-smoke',
          private: true,
          type: 'module',
          dependencies: {
            '@postcss-go/core': `file:${coreTarball}`,
            '@types/node': '^22.10.1',
          },
        },
        null,
        2,
      )}\n`,
    );

    npm(consumer, ['install', '--ignore-scripts', '--no-fund', '--no-audit']);

    for (const name of ['postcss', 'postcss-load-config', 'postcss-reporter']) {
      assertPackageAbsent(consumer, name);
    }

    writeFileSync(
      resolve(consumer, 'smoke.ts'),
      `import type { ProcessFileOptions } from '@postcss-go/core';\n` +
        `const options: ProcessFileOptions = { from: 'input.css' };\n` +
        `void options;\n`,
    );
    execFileSync(
      process.execPath,
      [
        resolve(repoRoot, 'node_modules/typescript/lib/tsc.js'),
        '--noEmit',
        '--strict',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--types',
        'node',
        'smoke.ts',
      ],
      { cwd: consumer, encoding: 'utf8' },
    );

    writeFileSync(
      resolve(consumer, 'smoke.mjs'),
      `import postcss from '@postcss-go/core';\n` +
        `const root = postcss.parse('a{color:red}');\n` +
        `if (root.type !== 'root' || root.toString() !== 'a{color:red}') {\n` +
        `  throw new Error('packed package smoke failed');\n` +
        `}\n`,
    );
    execFileSync(process.execPath, ['smoke.mjs'], { cwd: consumer, encoding: 'utf8' });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}, 60_000);
