#!/usr/bin/env node
/**
 * Fail if overall Go statement coverage is below the required threshold.
 *
 *   node scripts/check-go-coverage.mjs [coverprofile] [threshold]
 *
 * Defaults: coverage/go.out and 90.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = path.resolve(repoRoot, process.argv[2] ?? 'coverage/go.out');
const threshold = Number(process.argv[3] ?? 90);

if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
  console.error(`Invalid coverage threshold: ${process.argv[3]}`);
  process.exit(2);
}

if (!existsSync(profile)) {
  console.error(`Go coverage profile not found: ${profile}`);
  process.exit(1);
}

const result = spawnSync('go', ['tool', 'cover', `-func=${profile}`], {
  cwd: repoRoot,
  encoding: 'utf8',
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || 'go tool cover failed\n');
  process.exit(result.status ?? 1);
}

const totalLine = result.stdout
  .split('\n')
  .map((line) => line.trim())
  .find((line) => line.startsWith('total:'));

const match = totalLine?.match(/([\d.]+)%\s*$/);
if (!match) {
  console.error('Could not parse total coverage from go tool cover output');
  process.stderr.write(result.stdout);
  process.exit(1);
}

const coverage = Number(match[1]);
if (coverage + Number.EPSILON < threshold) {
  console.error(
    `Go coverage ${coverage.toFixed(1)}% is below the required ${threshold}% threshold`,
  );
  process.exit(1);
}

console.log(`Go coverage ${coverage.toFixed(1)}% meets the required ${threshold}% threshold`);
