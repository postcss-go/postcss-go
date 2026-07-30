#!/usr/bin/env node
/**
 * Prepare Vitest lcov reports for Codecov.
 *
 * 1. Rewrite SF: paths to be repo-root relative so monorepo packages do not
 *    collide on paths like `src/index.ts`.
 * 2. Strip BRDA/BRF/BRH records. Codecov treats lines with uncovered branches
 *    as partials/misses, which drops reported coverage ~6pp below Vitest's
 *    line coverage (and below the 90% project target) even when CI thresholds
 *    already pass.
 *
 *   node scripts/prepare-js-lcov-for-codecov.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const reports = [
  {
    file: 'packages/postcss-go/coverage/lcov.info',
    prefix: 'packages/postcss-go/',
  },
  {
    file: 'packages/postcss-compat/coverage/lcov.info',
    prefix: 'packages/postcss-compat/',
  },
  {
    file: 'packages/postcss-go-wasm/coverage/lcov.info',
    prefix: 'packages/postcss-go-wasm/',
  },
];

let rewritten = 0;
let stripped = 0;

for (const { file, prefix } of reports) {
  const abs = path.join(repoRoot, file);
  if (!existsSync(abs)) {
    console.error(`Missing lcov report: ${file}`);
    process.exit(1);
  }

  const output = readFileSync(abs, 'utf8')
    .split('\n')
    .flatMap((line) => {
      if (line.startsWith('BRDA:') || line.startsWith('BRF:') || line.startsWith('BRH:')) {
        stripped += 1;
        return [];
      }
      if (!line.startsWith('SF:')) return [line];
      const sf = line.slice(3);
      if (sf.startsWith(prefix) || path.isAbsolute(sf)) return [line];
      rewritten += 1;
      return [`SF:${prefix}${sf}`];
    })
    .join('\n');

  writeFileSync(abs, output);
  console.log(`Prepared ${file} (prefix ${prefix})`);
}

console.log(`Rewrote ${rewritten} SF paths; stripped ${stripped} branch records`);
