#!/usr/bin/env node
/**
 * Run postcss-go and external CSS engine benchmarks and print a comparison table.
 *
 *   pnpm bench
 *   node benchmark/run.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runGoBenchmarks() {
  const result = spawnSync(
    'go',
    ['test', '-mod=mod', './benchmark/', '-bench=.', '-benchmem', '-count=5'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }

  const lines = result.stdout.split('\n');
  const parsed = new Map();
  const totals = new Map();

  for (const line of lines) {
    const match = line.match(
      /^Benchmark(\w+)_(\w+)-\d+\s+\d+\s+([\d.]+)\s+ns\/op(?:\s+[\d.]+\s+MB\/s)?\s+([\d.]+)\s+B\/op\s+([\d.]+)\s+allocs\/op/,
    );
    if (!match) continue;

    const [, scenario, size, nsPerOp, bytesPerOp, allocsPerOp] = match;
    const name = `${scenario}/${size}`;
    const current = totals.get(name) ?? { nsPerOp: 0, bytesPerOp: 0, allocsPerOp: 0, count: 0 };
    current.nsPerOp += Number(nsPerOp);
    current.bytesPerOp += Number(bytesPerOp);
    current.allocsPerOp += Number(allocsPerOp);
    current.count += 1;
    totals.set(name, current);
  }

  for (const [name, current] of totals) {
    parsed.set(name, {
      nsPerOp: current.nsPerOp / current.count,
      bytesPerOp: current.bytesPerOp / current.count,
      allocsPerOp: current.allocsPerOp / current.count,
    });
  }

  return parsed;
}

function runNodeBenchmarks(script) {
  const result = spawnSync('node', [script], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }

  const parsed = new Map();
  for (const line of result.stdout.trim().split('\n')) {
    if (!line) continue;
    const entry = JSON.parse(line);
    parsed.set(entry.name, entry);
  }

  return parsed;
}

function formatNs(ns) {
  if (ns >= 1e6) return `${(ns / 1e6).toFixed(2)} ms/op`;
  if (ns >= 1e3) return `${(ns / 1e3).toFixed(1)} µs/op`;
  return `${Math.round(ns)} ns/op`;
}

function formatRatio(goNs, referenceNs) {
  if (!goNs || !referenceNs) return '—';
  const ratio = referenceNs / goNs;
  if (ratio >= 1) return `${ratio.toFixed(2)}x faster`;
  return `${(1 / ratio).toFixed(2)}x slower`;
}

function printSection(title, order, goResults, postcssResults, csstreeResults) {
  console.log(title);
  console.log('');
  console.log(
    [
      'Workload'.padEnd(40),
      'postcss-go'.padStart(14),
      'postcss'.padStart(14),
      'vs postcss'.padStart(16),
      'css-tree'.padStart(14),
      'vs css-tree'.padStart(16),
    ].join('  '),
  );
  console.log('-'.repeat(122));

  for (const name of order) {
    const go = goResults.get(name);
    const postcss = postcssResults.get(name);
    const csstree = csstreeResults.get(name);
    if (!go) continue;

    console.log(
      [
        name.padEnd(40),
        formatNs(go.nsPerOp).padStart(14),
        (postcss ? formatNs(postcss.nsPerOp) : '—').padStart(14),
        (postcss ? formatRatio(go.nsPerOp, postcss.nsPerOp) : '—').padStart(16),
        (csstree ? formatNs(csstree.nsPerOp) : '—').padStart(14),
        (csstree ? formatRatio(go.nsPerOp, csstree.nsPerOp) : '—').padStart(16),
      ].join('  '),
    );
  }

  console.log('');
}

function printParserSection(title, order, goResults, lezerResults, treeSitterResults) {
  console.log(title);
  console.log('');
  console.log(
    [
      'Workload'.padEnd(40),
      'postcss-go'.padStart(14),
      'lezer'.padStart(14),
      'vs lezer'.padStart(16),
      'tree-sitter'.padStart(14),
      'vs tree-sitter'.padStart(16),
    ].join('  '),
  );
  console.log('-'.repeat(122));

  for (const name of order) {
    const go = goResults.get(name);
    const lezer = lezerResults.get(name);
    const treeSitter = treeSitterResults.get(name);
    if (!go) continue;

    console.log(
      [
        name.padEnd(40),
        formatNs(go.nsPerOp).padStart(14),
        (lezer ? formatNs(lezer.nsPerOp) : '—').padStart(14),
        (lezer ? formatRatio(go.nsPerOp, lezer.nsPerOp) : '—').padStart(16),
        (treeSitter ? formatNs(treeSitter.nsPerOp) : '—').padStart(14),
        (treeSitter ? formatRatio(go.nsPerOp, treeSitter.nsPerOp) : '—').padStart(16),
      ].join('  '),
    );
  }

  console.log('');
}

const manifest = JSON.parse(
  readFileSync(path.join(repoRoot, 'benchmark/fixtures/manifest.json'), 'utf8'),
);
const realWorldIds = manifest.map((entry) => entry.id);

const syntheticOrder = [
  'Parse/Small',
  'Parse/Medium',
  'Parse/Large',
  'ParseStringify/Small',
  'ParseStringify/Medium',
  'ParseStringify/Large',
  'Process/Small',
  'Process/Medium',
  'Process/Large',
];

const realWorldOrder = [
  ...realWorldIds.map((id) => `ParseReal/${id}`),
  ...realWorldIds.map((id) => `ParseStringifyReal/${id}`),
  ...realWorldIds.map((id) => `ProcessReal/${id}`),
];
const parserSyntheticOrder = syntheticOrder.filter((name) => name.startsWith('Parse/'));
const parserRealWorldOrder = realWorldOrder.filter((name) => name.startsWith('ParseReal/'));

const goResults = runGoBenchmarks();
const postcssResults = runNodeBenchmarks('benchmark/postcss.bench.mjs');
const csstreeResults = runNodeBenchmarks('benchmark/csstree.bench.mjs');
const lezerResults = runNodeBenchmarks('benchmark/lezer.bench.mjs');
const treeSitterResults = runNodeBenchmarks('benchmark/tree-sitter.bench.mjs');

console.log('');
console.log('postcss-go CSS engine benchmark (lower ns/op is better)');
console.log('');

printSection(
  'Synthetic scaling workloads',
  syntheticOrder,
  goResults,
  postcssResults,
  csstreeResults,
);
printSection('Real-world CSS fixtures', realWorldOrder, goResults, postcssResults, csstreeResults);
printParserSection(
  'Parser-only baselines — synthetic scaling',
  parserSyntheticOrder,
  goResults,
  lezerResults,
  treeSitterResults,
);
printParserSection(
  'Parser-only baselines — real-world CSS',
  parserRealWorldOrder,
  goResults,
  lezerResults,
  treeSitterResults,
);

console.log(
  'Fixtures: modern-normalize, Tailwind preflight, animate.css, Bootstrap, Bulma, Pure.css, UIkit, Materialize',
);
console.log('Go:          go test -mod=mod ./benchmark/ -bench=. -benchmem -count=5');
console.log('PostCSS:     node benchmark/postcss.bench.mjs');
console.log('CSSTree:     node benchmark/csstree.bench.mjs');
console.log('Lezer CSS:   node benchmark/lezer.bench.mjs');
console.log('Tree-sitter: node benchmark/tree-sitter.bench.mjs');
console.log('Upstreams: https://github.com/postcss/postcss');
console.log('           https://github.com/csstree/csstree');
console.log('           https://github.com/lezer-parser/css');
console.log('           https://github.com/tree-sitter/tree-sitter-css');
console.log('');
