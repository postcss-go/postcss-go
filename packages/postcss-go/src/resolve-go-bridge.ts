import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NodePostcssGoServiceOptions } from './node.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundledBinPath = join(
  packageRoot,
  'bin',
  process.platform === 'win32' ? 'postcss-go.exe' : 'postcss-go',
);
const monorepoRoot = resolve(packageRoot, '..', '..');
const monorepoBridgeEntry = join(monorepoRoot, 'cmd', 'api', 'main.go');

export function getBundledGoBridgeBinPath(): string {
  return bundledBinPath;
}

export function resolveGoBridgeServiceOptions(): NodePostcssGoServiceOptions {
  const envBin = process.env.POSTCSS_GO_NODE_API_BIN;
  if (envBin) {
    return { binPath: envBin };
  }

  if (existsSync(bundledBinPath)) {
    return { binPath: bundledBinPath, binArgs: ['--single'] };
  }

  if (existsSync(monorepoBridgeEntry)) {
    return { workingDirectory: monorepoRoot };
  }

  throw new Error(
    'Engine Error: postcss-go bridge binary not found. Reinstall @postcss-go/core or set POSTCSS_GO_NODE_API_BIN.',
  );
}
