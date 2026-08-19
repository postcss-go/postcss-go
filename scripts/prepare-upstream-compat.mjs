#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorLib = path.join(repoRoot, 'vendor', 'postcss', 'lib');
const targetLib = process.env.POSTCSS_COMPAT_TARGET_LIB ?? vendorLib;
const overridesDir = path.join(repoRoot, 'packages', 'postcss-compat', 'overrides');
const goDistDir = path.join(repoRoot, 'packages', 'postcss-compat', 'dist');
const mode = process.env.POSTCSS_COMPAT_MODE ?? 'upstream';

if (!fs.existsSync(targetLib) || !fs.statSync(targetLib).isDirectory()) {
  console.error(`Missing vendored upstream lib at ${targetLib}`);
  console.error('Run `node ./scripts/sync-upstream-postcss-tests.mjs` first.');
  process.exit(1);
}

// Go overrides must only land on a temp copy (see run-upstream-tests.mjs). Writing
// them into vendor/postcss/lib permanently breaks POSTCSS_COMPAT_MODE=upstream.
if (
  mode === 'go' &&
  path.resolve(targetLib) === path.resolve(vendorLib) &&
  process.env.POSTCSS_COMPAT_ALLOW_VENDOR_WRITE !== '1'
) {
  console.error('Refusing to apply Go overrides directly to vendor/postcss/lib.');
  console.error('Use `pnpm test:upstream:go` (temp copy) or set POSTCSS_COMPAT_TARGET_LIB.');
  process.exit(1);
}

function applyOverride(file) {
  if (!file.endsWith('.js')) return;
  fs.copyFileSync(file, path.join(targetLib, path.basename(file)));
}

function applyOverridesFrom(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (fs.statSync(file).isFile()) applyOverride(file);
  }
}

switch (mode) {
  case 'upstream':
    applyOverridesFrom(path.join(overridesDir, 'upstream'));
    break;
  case 'go': {
    if (!fs.existsSync(goDistDir) || !fs.statSync(goDistDir).isDirectory()) {
      console.error(`Missing Go compat build output at ${goDistDir}`);
      console.error('Run `pnpm --filter postcss-go-compat build` first.');
      process.exit(1);
    }
    applyOverridesFrom(goDistDir);
    break;
  }
  default:
    console.error(`Unsupported POSTCSS_COMPAT_MODE: ${mode} (expected upstream or go)`);
    process.exit(1);
}

console.log(`Prepared upstream compat lib (mode=${mode})`);
