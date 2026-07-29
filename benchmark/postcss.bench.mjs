/**
 * Benchmark postcss (https://github.com/postcss/postcss) using the same
 * workloads as benchmark/bench_test.go.
 *
 * Output is JSON lines for benchmark/run.mjs.
 */
import postcss from 'postcss';
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
  return manifest.map((entry) => ({
    id: entry.id,
    css: readFileSync(path.join(repoRoot, 'benchmark/fixtures', entry.file), 'utf8'),
    bytes: readFileSync(path.join(repoRoot, 'benchmark/fixtures', entry.file)).byteLength,
  }));
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
  } else if (bytes === 0) {
    // synthetic workloads keyed by rule count via rules param below
  }

  for (let i = 0; i < warmup; i++) fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsedMs = performance.now() - start;

  const nsPerOp = (elapsedMs * 1e6) / iterations;
  return {
    name,
    nsPerOp: Math.round(nsPerOp),
    iterations,
  };
}

function benchSynthetic(name, fn, rules) {
  let options;
  if (rules >= 10_000) {
    options = { warmup: 5, iterations: 20, bytes: 0 };
  } else if (rules >= 1_000) {
    options = { warmup: 20, iterations: 100, bytes: 0 };
  } else {
    options = { warmup: 50, iterations: 500, bytes: 0 };
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
      `Parse/${label}`,
      () => {
        postcss.parse(css);
      },
      rules,
    ),
  );

  results.push(
    benchSynthetic(
      `ParseStringify/${label}`,
      () => {
        const root = postcss.parse(css);
        root.toString();
      },
      rules,
    ),
  );

  results.push(
    benchSynthetic(
      `Process/${label}`,
      () => {
        const root = postcss.parse(css);
        root.walk(() => {});
        root.toString();
      },
      rules,
    ),
  );
}

for (const fixture of loadRealWorldFixtures()) {
  results.push(
    bench(
      `ParseReal/${fixture.id}`,
      () => {
        postcss.parse(fixture.css);
      },
      { bytes: fixture.bytes },
    ),
  );

  results.push(
    bench(
      `ParseStringifyReal/${fixture.id}`,
      () => {
        const root = postcss.parse(fixture.css);
        root.toString();
      },
      { bytes: fixture.bytes },
    ),
  );

  results.push(
    bench(
      `ProcessReal/${fixture.id}`,
      () => {
        const root = postcss.parse(fixture.css);
        root.walk(() => {});
        root.toString();
      },
      { bytes: fixture.bytes },
    ),
  );
}

for (const result of results) {
  console.log(JSON.stringify(result));
}
