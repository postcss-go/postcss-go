import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

test('npm package contains the native addon for the build platform', () => {
  const platform = `${process.platform}-${process.arch}`;
  const addonName = `native/prebuilds/${platform}/postcss_go.node`;
  const addonPath = resolve(packageRoot, addonName);

  // Go c-archive is MinGW-only on Windows while node-gyp links with MSVC, so the
  // native `.node` often cannot be produced there. Stdio JSON-RPC remains the
  // fallback; still assert pack contents whenever the addon did build.
  if (!existsSync(addonPath)) {
    if (process.platform !== 'win32') {
      expect.fail(`native addon missing at ${addonPath}; expected on ${platform}`);
    }
    return;
  }

  expect(npmPackFiles(packageRoot)).toContain(addonName);
});
