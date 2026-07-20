import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const packageDir = path.join(repoRoot, 'packages', 'postcss-go');
const outputDir = path.join(packageDir, 'bin');
const outputName = process.platform === 'win32' ? 'postcss-go.exe' : 'postcss-go';
const outputPath = path.join(outputDir, outputName);

fs.mkdirSync(outputDir, { recursive: true });

const result = spawnSync('go', ['build', '-mod=mod', '-o', outputPath, './cmd/api'], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    GOFLAGS: process.env.GOFLAGS ? `${process.env.GOFLAGS} -mod=mod` : '-mod=mod',
  },
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
