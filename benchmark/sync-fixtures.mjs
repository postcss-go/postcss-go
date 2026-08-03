#!/usr/bin/env node
/**
 * Refresh the vendored real-world CSS fixtures used by both benchmark suites.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(repoRoot, 'benchmark', 'fixtures', 'css');

const fixtures = [
  [
    'modern-normalize.css',
    'https://cdn.jsdelivr.net/npm/modern-normalize@3.0.1/modern-normalize.css',
  ],
  [
    'tailwind-preflight.css',
    'https://cdn.jsdelivr.net/npm/tailwindcss@3.4.17/src/css/preflight.css',
  ],
  ['animate.min.css', 'https://cdn.jsdelivr.net/npm/animate.css@4.1.1/animate.min.css'],
  ['bootstrap.css', 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.css'],
  ['bootstrap.min.css', 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css'],
  ['bulma.css', 'https://cdn.jsdelivr.net/npm/bulma@1.0.4/css/bulma.css'],
  ['pure.css', 'https://cdn.jsdelivr.net/npm/purecss@3.0.0/build/pure.css'],
  ['uikit.css', 'https://cdn.jsdelivr.net/npm/uikit@3.25.20/dist/css/uikit.css'],
  [
    'materialize.css',
    'https://cdn.jsdelivr.net/npm/materialize-css@1.0.0/dist/css/materialize.css',
  ],
];

fs.mkdirSync(dir, { recursive: true });

for (const [name, url] of fixtures) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    console.error(`Failed to download ${url}: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  if (!response.ok) {
    console.error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
    process.exit(1);
  }
  fs.writeFileSync(path.join(dir, name), Buffer.from(await response.arrayBuffer()));
}

console.log(`Synced benchmark fixtures into ${dir}`);
