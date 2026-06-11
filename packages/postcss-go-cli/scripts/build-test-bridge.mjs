import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(packageDir, '..', '..');
const outputDir = path.join(packageDir, 'dist');
const outputPath = path.join(outputDir, 'postcss-go-node-api');

fs.mkdirSync(outputDir, { recursive: true });

const result = spawnSync(
  'go',
  ['build', '-mod=mod', '-o', outputPath, './cmd/postcss-go-node-api'],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      GOFLAGS: process.env.GOFLAGS ? `${process.env.GOFLAGS} -mod=mod` : '-mod=mod',
    },
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
