#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = 'github.com/postcss-go/postcss-go';

const rootModule = readFileSync(resolve(repoRoot, 'go.mod'), 'utf8')
  .split('\n')
  .find((line) => line.startsWith('module '))
  ?.trim();

const legacyImports = execSync(`rg -n '"postcss-go/' --glob '*.go' --glob '!vendor/**' || true`, {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim();

const problems = [];
if (rootModule !== `module ${modulePath}`) {
  problems.push(
    `Root go.mod must declare "module ${modulePath}", found "${rootModule ?? '(missing)'}"`,
  );
}
if (legacyImports) {
  problems.push(`Legacy import paths must use ${modulePath}/:\n${legacyImports}`);
}

if (problems.length > 0) {
  console.error(problems.join('\n\n'));
  process.exit(1);
}

console.log(`postcss-go: Go module path checks passed (${modulePath})`);
