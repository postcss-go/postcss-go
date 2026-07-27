import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('npm package contains the native addon for the build platform', () => {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const output = execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  const [{ files }] = JSON.parse(output) as Array<{ files: Array<{ path: string }> }>;
  const platform = `${process.platform}-${process.arch}`;

  expect(files.map((file) => file.path)).toContain(`native/prebuilds/${platform}/postcss_go.node`);
});
