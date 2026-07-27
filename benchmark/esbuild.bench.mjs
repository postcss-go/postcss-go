/**
 * Benchmark esbuild's CSS transform using the same parse + stringify
 * workloads as benchmark/bench_test.go.
 *
 * esbuild does not expose its CSS AST parser, so this benchmark only emits
 * ParseStringify results.
 *
 * Output is JSON lines for scripts/compare-benchmarks.mjs.
 */
import { transformSync } from 'esbuild';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  readFileSync(path.join(repoRoot, 'benchmark/fixtures/manifest.json'), 'utf8'),
);

const SmallRules = 10;
const MediumRules = 1_000;
const LargeRules = 10_000;

function generateCSS(rules) {
  let css = '';
  for (let i = 0; i < rules; i++) {
    css += `.class-${i} { color: #${(i & 0xffffff).toString(16).padStart(6, '0')}; margin: ${i % 10}px; padding: ${i % 20}px; display: flex; }\n`;
  }
  return css;
}

function loadRealWorldFixtures() {
  return manifest.map((entry) => {
    const css = readFileSync(path.join(repoRoot, 'benchmark/fixtures', entry.file), 'utf8');
    return { id: entry.id, css, bytes: Buffer.byteLength(css) };
  });
}

function transformWithoutOptimization(css, sourcefile) {
  return transformSync(css, {
    loader: 'css',
    sourcefile,
    minify: false,
    target: 'esnext',
    sourcemap: false,
    logLevel: 'silent',
  });
}

function bench(name, fn, { warmup = 50, iterations = 500, bytes = 0 } = {}) {
  if (bytes >= 200_000) {
    iterations = 20;
    warmup = 5;
  } else if (bytes >= 50_000) {
    iterations = 50;
    warmup = 10;
  } else if (bytes >= 5_000) {
    iterations = 200;
    warmup = 20;
  }

  for (let i = 0; i < warmup; i++) fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsedMs = performance.now() - start;

  return {
    name,
    nsPerOp: Math.round((elapsedMs * 1e6) / iterations),
    iterations,
  };
}

function benchSynthetic(name, fn, rules) {
  let options;
  if (rules >= 10_000) {
    options = { warmup: 5, iterations: 20 };
  } else if (rules >= 1_000) {
    options = { warmup: 20, iterations: 100 };
  } else {
    options = { warmup: 50, iterations: 500 };
  }
  return bench(name, fn, options);
}

const results = [];
const workloads = [
  ['Small', SmallRules],
  ['Medium', MediumRules],
  ['Large', LargeRules],
];

for (const [label, rules] of workloads) {
  const css = generateCSS(rules);
  results.push(
    benchSynthetic(
      `ParseStringify/${label}`,
      () => transformWithoutOptimization(css, `${label.toLowerCase()}.css`),
      rules,
    ),
  );
}

for (const fixture of loadRealWorldFixtures()) {
  results.push(
    bench(
      `ParseStringifyReal/${fixture.id}`,
      () => transformWithoutOptimization(fixture.css, `${fixture.id}.css`),
      { bytes: fixture.bytes },
    ),
  );
}

for (const result of results) {
  console.log(JSON.stringify(result));
}
