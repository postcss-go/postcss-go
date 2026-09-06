// Production native bridge gate for the explicitly restricted scalar workload.
// Build first. Each sample has an isolated Go/V8 heap; no prototype addon is used.
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';

const samples = 5;
const sizes = [1000, 10000];
if (process.argv[2] === '--sample') {
  const { Processor } = await import('../packages/postcss-go/dist/index.js');
  const count = Number(process.argv[3]);
  const css = 'a{' + 'color:red;'.repeat(count) + '}';
  const expected = css.replaceAll('red', 'navy');
  const processor = new Processor([
    {
      postcssPlugin: 'handle-benchmark',
      Declaration(decl) {
        if (decl.value === 'red') decl.value = 'navy';
      },
    },
  ]);
  const run = () => processor.processSync(css, { map: false, from: 'bench.css' }).css;
  for (let i = 0; i < 10; i++) assert.equal(run(), expected);
  const start = performance.now();
  for (let i = 0; i < 30; i++) assert.equal(run(), expected);
  console.log(
    JSON.stringify({ ms: (performance.now() - start) / 30, rss: process.resourceUsage().maxRSS }),
  );
} else {
  const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
  let passed = true;
  for (const size of sizes) {
    const results = { binary: [], handle: [] };
    for (let i = 0; i < samples; i++) {
      for (const mode of i % 2 ? ['handle', 'binary'] : ['binary', 'handle']) {
        const child = spawnSync(
          process.execPath,
          [new URL(import.meta.url).pathname, '--sample', String(size)],
          {
            encoding: 'utf8',
            timeout: 120000,
            env: { ...process.env, POSTCSS_GO_NATIVE_AST: mode },
          },
        );
        assert.equal(child.status, 0, child.stderr);
        results[mode].push(JSON.parse(child.stdout));
      }
    }
    const timeRatio =
      median(results.handle.map((x) => x.ms)) / median(results.binary.map((x) => x.ms));
    const rssRatio =
      median(results.handle.map((x) => x.rss)) / median(results.binary.map((x) => x.rss));
    const pass = timeRatio <= 1.05 && rssRatio <= 1.1;
    passed &&= pass;
    console.log(
      JSON.stringify({ declarations: size, samples, timeRatio, rssRatio, pass, results }),
    );
  }
  if (!passed) process.exitCode = 1;
}
