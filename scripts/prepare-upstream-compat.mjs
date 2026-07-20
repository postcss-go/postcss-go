#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetLib =
  process.env.POSTCSS_COMPAT_TARGET_LIB ?? path.join(repoRoot, 'vendor', 'postcss', 'lib');
const overridesDir = path.join(repoRoot, 'packages', 'postcss-compat', 'overrides');
const mode = process.env.POSTCSS_COMPAT_MODE ?? 'upstream';

if (!fs.existsSync(targetLib) || !fs.statSync(targetLib).isDirectory()) {
  console.error(`Missing vendored upstream lib at ${targetLib}`);
  console.error('Run `node ./scripts/sync-upstream-postcss-tests.mjs` first.');
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
    const goDir = path.join(overridesDir, 'go');
    if (!fs.existsSync(goDir) || !fs.statSync(goDir).isDirectory()) {
      console.error(`Missing Go compat overrides at ${goDir}`);
      process.exit(1);
    }
    applyOverridesFrom(goDir);
    break;
  }
  default:
    console.error(`Unsupported POSTCSS_COMPAT_MODE: ${mode} (expected upstream or go)`);
    process.exit(1);
}

console.log(`Prepared upstream compat lib (mode=${mode})`);
