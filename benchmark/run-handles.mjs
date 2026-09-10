// Production native bridge measurements for the Phase 2 read-only facade.
// Build first. Each sample has an isolated Go/V8 heap; no prototype addon is used.
import { summarize } from './qualification-metrics.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus, platform, release, arch } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const samples = 5;
const qualification = process.argv.includes('--qualification');
const sizes =
  qualification && !process.argv.includes('--stress')
    ? [1000, 'modern-normalize']
    : [1000, 10000, 'modern-normalize'];
const fixture = (size) =>
  size === 'modern-normalize'
    ? readFileSync(new URL('./fixtures/css/modern-normalize.css', import.meta.url), 'utf8')
    : 'a{' + 'color:red;'.repeat(Number(size)) + '}';
if (process.argv[2] === '--sample') {
  const { Processor } = await import('../packages/postcss-go/dist/index.js');
  const size = process.argv[3];
  const css = fixture(size);
  const expected = css;
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
  for (let i = 0; i < 10; i++) assert.equal(run(), expected);
  const start = performance.now();
  for (let i = 0; i < 30; i++) assert.equal(run(), expected);
  console.log(
    JSON.stringify({
      ms: (performance.now() - start) / 30,
      rss: process.resourceUsage().maxRSS,
      readCount,
      checksum,
    }),
  );
} else {
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
      scope:
        'Phase 2 read-only facade; not comparable to historical scalar writes; no rollout claim',
    }),
  );
  let passed = true;
  for (const size of sizes) {
    const results = { binary: [], handle: [] };
    for (let i = 0; i < samples; i++) {
      for (const mode of i % 2 ? ['handle', 'binary'] : ['binary', 'handle']) {
        const child = spawnSync(
          process.execPath,
          [fileURLToPath(import.meta.url), '--sample', String(size)],
          {
            encoding: 'utf8',
            timeout: 120000,
            env: { ...process.env, POSTCSS_GO_NATIVE_AST: mode },
          },
        );
        assert.equal(child.status, 0, child.stderr);
        const measured = JSON.parse(child.stdout);
        const reference = results.binary[0] ?? results.handle[0];
        if (reference) {
          assert.equal(measured.readCount, reference.readCount, 'visitor count differs');
          assert.equal(measured.checksum, reference.checksum, 'scalar reads differ');
        }
        results[mode].push(measured);
      }
    }
    const { timeRatio, rssRatio, spread, stable, pass } = summarize(results);
    passed &&= pass;
    console.log(
      JSON.stringify({
        declarations: size,
        fixtureBytes: Buffer.byteLength(fixture(size)),
        fixtureSha256: createHash('sha256').update(fixture(size)).digest('hex'),
        samples,
        timeRatio,
        rssRatio,
        stable,
        spread,
        pass,
        results,
      }),
    );
  }
  if (!passed && !qualification) process.exitCode = 1;
}
