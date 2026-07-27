import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '../../..');

const fixtureDir = resolve(repoRoot, 'benchmark/fixtures');

/**
 * The same fixtures the Go half uses, resolved through the shared manifest so
 * there is one source of truth. Names match the manifest IDs, which lets the
 * Go and JavaScript measurements be lined up per fixture.
 */
const FIXTURE_IDS = ['ModernNormalize', 'TailwindPreflight', 'AnimateMin', 'Bootstrap'];

export function loadFixtures() {
  const manifest = JSON.parse(readFileSync(resolve(fixtureDir, 'manifest.json'), 'utf8'));
  const byId = new Map(manifest.map((entry) => [entry.id, entry]));

  const fixtures = FIXTURE_IDS.map((id) => {
    const entry = byId.get(id);
    if (!entry) throw new Error(`fixture ${id} is missing from the benchmark manifest`);
    return { name: id, css: readFileSync(resolve(fixtureDir, entry.file), 'utf8') };
  });

  fixtures.push({ name: 'Generated10k', css: generateCSS(10_000) });
  return fixtures;
}

/** Mirrors benchmark.GenerateCSS so Go and Node numbers line up. */
export function generateCSS(rules) {
  let out = '';
  for (let i = 0; i < rules; i += 1) {
    const color = (i & 0xffffff).toString(16).padStart(6, '0');
    out += `.class-${i} { color: #${color}; margin: ${i % 10}px; padding: ${i % 20}px; display: flex; }\n`;
  }
  return out;
}

/** Counts DTO nodes by type so per-node costs can be derived. */
export function countNodes(node, counts = { total: 0 }) {
  counts.total += 1;
  counts[node.type] = (counts[node.type] ?? 0) + 1;
  if (node.nodes) {
    for (const child of node.nodes) countNodes(child, counts);
  }
  return counts;
}
