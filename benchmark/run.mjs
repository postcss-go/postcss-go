#!/usr/bin/env node
/**
 * Benchmark CLI.
 *
 *   pnpm bench                         # compare Go vs JS engines
 *   node benchmark/run.mjs compare
 *   node benchmark/run.mjs postcss     # one JS engine (JSON lines)
 *   node benchmark/run.mjs csstree
 *   node benchmark/run.mjs lezer
 *   node benchmark/run.mjs tree-sitter
 *   node benchmark/run.mjs handles     # native handle facade
 *   node benchmark/run.mjs sync        # refresh vendored CSS fixtures
 */
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, arch } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { summarize } from './qualification-metrics.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const fixtureDir = path.join(repoRoot, 'benchmark', 'fixtures');
const SYNTHETIC = [
  ['Small', 10],
  ['Medium', 1_000],
  ['Large', 10_000],
];
const FIXTURE_URLS = [
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

function generateCSS(rules) {
  let css = '';
  for (let i = 0; i < rules; i++) {
    css += `.class-${i} { color: #${(i & 0xffffff).toString(16).padStart(6, '0')}; margin: ${i % 10}px; padding: ${i % 20}px; display: flex; }\n`;
  }
  return css;
}

function loadFixtures() {
  const manifest = JSON.parse(readFileSync(path.join(fixtureDir, 'manifest.json'), 'utf8'));
  return manifest.map((entry) => {
    const file = path.join(fixtureDir, entry.file);
    const buffer = readFileSync(file);
    return { id: entry.id, css: buffer.toString('utf8'), bytes: buffer.byteLength };
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
  return {
    name,
    nsPerOp: Math.round(((performance.now() - start) * 1e6) / iterations),
    iterations,
  };
}

function benchSynthetic(name, fn, rules) {
  const options =
    rules >= 10_000
      ? { warmup: 5, iterations: 20 }
      : rules >= 1_000
        ? { warmup: 20, iterations: 100 }
        : { warmup: 50, iterations: 500 };
  return bench(name, fn, options);
}

function runWorkloads({ parse, parseStringify, process }) {
  const results = [];
  for (const [label, rules] of SYNTHETIC) {
    const css = generateCSS(rules);
    results.push(benchSynthetic(`Parse/${label}`, () => parse(css), rules));
    if (parseStringify) {
      results.push(benchSynthetic(`ParseStringify/${label}`, () => parseStringify(css), rules));
    }
    if (process) {
      results.push(benchSynthetic(`Process/${label}`, () => process(css), rules));
    }
  }
  for (const fixture of loadFixtures()) {
    results.push(
      bench(`ParseReal/${fixture.id}`, () => parse(fixture.css), { bytes: fixture.bytes }),
    );
    if (parseStringify) {
      results.push(
        bench(`ParseStringifyReal/${fixture.id}`, () => parseStringify(fixture.css), {
          bytes: fixture.bytes,
        }),
      );
    }
    if (process) {
      results.push(
        bench(`ProcessReal/${fixture.id}`, () => process(fixture.css), { bytes: fixture.bytes }),
      );
    }
  }
  return results;
}

const engines = {
  async postcss() {
    const postcss = (await import('postcss')).default;
    return runWorkloads({
      parse: (css) => postcss.parse(css),
      parseStringify: (css) => postcss.parse(css).toString(),
      process: (css) => {
        const root = postcss.parse(css);
        root.walk(() => {});
        return root.toString();
      },
    });
  },
  async csstree() {
    const csstree = await import('css-tree');
    const parseOptions = { positions: true };
    return runWorkloads({
      parse: (css) => csstree.parse(css, parseOptions),
      parseStringify: (css) => csstree.generate(csstree.parse(css, parseOptions)),
      process: (css) => {
        const ast = csstree.parse(css, parseOptions);
        csstree.walk(ast, () => {});
        return csstree.generate(ast);
      },
    });
  },
  async lezer() {
    const { parser } = await import('@lezer/css');
    return runWorkloads({ parse: (css) => parser.parse(css) });
  },
  async 'tree-sitter'() {
    const { Language, Parser } = await import('web-tree-sitter');
    await Parser.init();
    const parser = new Parser();
    parser.setLanguage(
      await Language.load(
        fileURLToPath(import.meta.resolve('tree-sitter-css/tree-sitter-css.wasm')),
      ),
    );
    return runWorkloads({
      parse: (css) => {
        const tree = parser.parse(css);
        tree.delete();
      },
    });
  },
};

function printJsonLines(results) {
  for (const result of results) console.log(JSON.stringify(result));
}

function resultsToMap(results) {
  return new Map(results.map((entry) => [entry.name, entry]));
}

function runGoBenchmarks() {
  const result = spawnSync(
    'go',
    ['test', '-mod=mod', './benchmark/', '-bench=.', '-benchmem', '-count=5'],
    { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }

  const totals = new Map();
  for (const line of result.stdout.split('\n')) {
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

  const parsed = new Map();
  for (const [name, current] of totals) {
    parsed.set(name, {
      nsPerOp: current.nsPerOp / current.count,
      bytesPerOp: current.bytesPerOp / current.count,
      allocsPerOp: current.allocsPerOp / current.count,
    });
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
  return ratio >= 1 ? `${ratio.toFixed(2)}x faster` : `${(1 / ratio).toFixed(2)}x slower`;
}

function printSection(title, order, goResults, leftResults, rightResults, labels) {
  console.log(title);
  console.log('');
  console.log(
    [
      'Workload'.padEnd(40),
      'postcss-go'.padStart(14),
      labels.left.padStart(14),
      labels.vsLeft.padStart(16),
      labels.right.padStart(14),
      labels.vsRight.padStart(16),
    ].join('  '),
  );
  console.log('-'.repeat(122));

  for (const name of order) {
    const go = goResults.get(name);
    if (!go) continue;
    const left = leftResults.get(name);
    const right = rightResults.get(name);
    console.log(
      [
        name.padEnd(40),
        formatNs(go.nsPerOp).padStart(14),
        (left ? formatNs(left.nsPerOp) : '—').padStart(14),
        (left ? formatRatio(go.nsPerOp, left.nsPerOp) : '—').padStart(16),
        (right ? formatNs(right.nsPerOp) : '—').padStart(14),
        (right ? formatRatio(go.nsPerOp, right.nsPerOp) : '—').padStart(16),
      ].join('  '),
    );
  }
  console.log('');
}

async function compare() {
  const realWorldIds = loadFixtures().map((entry) => entry.id);
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

  const goResults = runGoBenchmarks();
  const postcssResults = resultsToMap(await engines.postcss());
  const csstreeResults = resultsToMap(await engines.csstree());
  const lezerResults = resultsToMap(await engines.lezer());
  const treeSitterResults = resultsToMap(await engines['tree-sitter']());

  console.log('');
  console.log('postcss-go CSS engine benchmark (lower ns/op is better)');
  console.log('');

  const vsPostcss = {
    left: 'postcss',
    vsLeft: 'vs postcss',
    right: 'css-tree',
    vsRight: 'vs css-tree',
  };
  printSection(
    'Synthetic scaling workloads',
    syntheticOrder,
    goResults,
    postcssResults,
    csstreeResults,
    vsPostcss,
  );
  printSection(
    'Real-world CSS fixtures',
    realWorldOrder,
    goResults,
    postcssResults,
    csstreeResults,
    vsPostcss,
  );

  const vsParser = {
    left: 'lezer',
    vsLeft: 'vs lezer',
    right: 'tree-sitter',
    vsRight: 'vs tree-sitter',
  };
  printSection(
    'Parser-only baselines — synthetic scaling',
    syntheticOrder.filter((name) => name.startsWith('Parse/')),
    goResults,
    lezerResults,
    treeSitterResults,
    vsParser,
  );
  printSection(
    'Parser-only baselines — real-world CSS',
    realWorldOrder.filter((name) => name.startsWith('ParseReal/')),
    goResults,
    lezerResults,
    treeSitterResults,
    vsParser,
  );

  console.log(
    'Fixtures: modern-normalize, Tailwind preflight, animate.css, Bootstrap, Bulma, Pure.css, UIkit, Materialize',
  );
  console.log('Go:          go test -mod=mod ./benchmark/ -bench=. -benchmem -count=5');
  console.log('PostCSS:     node benchmark/run.mjs postcss');
  console.log('CSSTree:     node benchmark/run.mjs csstree');
  console.log('Lezer CSS:   node benchmark/run.mjs lezer');
  console.log('Tree-sitter: node benchmark/run.mjs tree-sitter');
  console.log('Upstreams: https://github.com/postcss/postcss');
  console.log('           https://github.com/csstree/csstree');
  console.log('           https://github.com/lezer-parser/css');
  console.log('           https://github.com/tree-sitter/tree-sitter-css');
  console.log('');
}

async function syncFixtures() {
  const dir = path.join(fixtureDir, 'css');
  mkdirSync(dir, { recursive: true });
  for (const [name, url] of FIXTURE_URLS) {
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
    writeFileSync(path.join(dir, name), Buffer.from(await response.arrayBuffer()));
  }
  console.log(`Synced benchmark fixtures into ${dir}`);
}

function handleFixture(size) {
  return size === 'modern-normalize'
    ? readFileSync(path.join(fixtureDir, 'css', 'modern-normalize.css'), 'utf8')
    : `a{${'color:red;'.repeat(Number(size))}}`;
}

async function sampleHandle(size) {
  const { Processor } = await import('../packages/postcss-go/dist/index.js');
  const css = handleFixture(size);
  let readCount = 0;
  let checksum = 0;
  const processor = new Processor([
    {
      postcssPlugin: 'handle-benchmark',
      Declaration(decl) {
        readCount++;
        checksum += decl.prop.length + decl.value.length + (decl.parent?.type.length ?? 0);
      },
    },
  ]);
  const run = () => {
    readCount = 0;
    checksum = 0;
    return processor.processSync(css, { map: false, from: 'bench.css' }).css;
  };
  for (let i = 0; i < 10; i++) assert.equal(run(), css);
  const start = performance.now();
  for (let i = 0; i < 30; i++) assert.equal(run(), css);
  console.log(
    JSON.stringify({
      ms: (performance.now() - start) / 30,
      rss: process.resourceUsage().maxRSS,
      readCount,
      checksum,
    }),
  );
}

async function handles({ qualification, stress }) {
  const samples = 5;
  const sizes =
    qualification && !stress ? [1000, 'modern-normalize'] : [1000, 10000, 'modern-normalize'];
  console.log(
    JSON.stringify({
      kind: 'environment',
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      node: process.version,
      go: execFileSync('go', ['version'], { encoding: 'utf8' }).trim(),
      cpu: cpus()[0].model,
      os: `${platform()} ${release()} ${arch()}`,
      warmups: 10,
      iterations: 30,
      rssUnit: 'KiB',
      scope: 'Production native handle facade; isolated-process samples; no rollout claim',
    }),
  );
  let passed = true;
  for (const size of sizes) {
    const results = { samples: [] };
    for (let i = 0; i < samples; i++) {
      const child = spawnSync(process.execPath, [scriptPath, 'handles', '--sample', String(size)], {
        encoding: 'utf8',
        timeout: 120000,
        env: process.env,
      });
      assert.equal(child.status, 0, child.stderr);
      const measured = JSON.parse(child.stdout);
      const reference = results.samples[0];
      if (reference) {
        assert.equal(measured.readCount, reference.readCount, 'visitor count differs');
        assert.equal(measured.checksum, reference.checksum, 'scalar reads differ');
      }
      results.samples.push(measured);
    }
    const { medianMs, peakRss, spread, stable, pass } = summarize(results);
    passed &&= pass;
    const css = handleFixture(size);
    console.log(
      JSON.stringify({
        declarations: size,
        fixtureBytes: Buffer.byteLength(css),
        fixtureSha256: createHash('sha256').update(css).digest('hex'),
        samples,
        medianMs,
        peakRss,
        stable,
        spread,
        pass,
        results,
      }),
    );
  }
  if (!passed && !qualification) process.exitCode = 1;
}

function parseArgs(argv) {
  const flags = new Set();
  const positionals = [];
  let sample;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sample') {
      sample = argv[++i];
      continue;
    }
    if (argv[i].startsWith('--')) {
      flags.add(argv[i]);
      continue;
    }
    positionals.push(argv[i]);
  }
  return {
    command: positionals[0] ?? 'compare',
    sample,
    qualification: flags.has('--qualification'),
    stress: flags.has('--stress'),
    help: flags.has('--help') || flags.has('-h') || positionals[0] === 'help',
  };
}

function usage(exitCode = 1) {
  console.log(`Usage: node benchmark/run.mjs [command]

Commands:
  compare       Compare Go vs PostCSS / CSSTree / Lezer / Tree-sitter (default)
  postcss       Run the PostCSS Node benchmark (JSON lines)
  csstree       Run the CSSTree Node benchmark (JSON lines)
  lezer         Run the Lezer CSS parse benchmark (JSON lines)
  tree-sitter   Run the Tree-sitter CSS parse benchmark (JSON lines)
  handles       Measure the production native handle facade
  sync          Refresh vendored real-world CSS fixtures
`);
  process.exit(exitCode);
}

const { command, sample, qualification, stress, help } = parseArgs(process.argv.slice(2));
if (help || command === '-h') usage(0);
if (command === 'compare') await compare();
else if (command in engines) printJsonLines(await engines[command]());
else if (command === 'sync') await syncFixtures();
else if (command === 'handles') {
  if (sample !== undefined) await sampleHandle(sample);
  else await handles({ qualification, stress });
} else {
  console.error(`Unknown command: ${command}\n`);
  usage(1);
}
