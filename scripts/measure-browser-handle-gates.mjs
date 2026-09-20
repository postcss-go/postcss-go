// Phase 8: main-thread handle session must stay within 5% time / 10% memory and wasm size of Worker-only.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/postcss-go');
const { createServer } = await import(
  createRequire(resolve(packageRoot, 'package.json')).resolve('vite')
);
const LIMITS = {
  startup: 1.05,
  'median process': 1.05,
  'compressed wasm': 1.1,
  'peak memory': 1.1,
};

const server = await createServer({
  root: packageRoot,
  logLevel: 'warn',
  plugins: [
    {
      name: 'postcss-go-cross-origin-isolation',
      configureServer(devServer) {
        devServer.middlewares.use((_request, response, next) => {
          response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
          response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
          next();
        });
      },
    },
  ],
  server: { host: '127.0.0.1', port: 0, strictPort: false },
});

let browser;
let report;
try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not expose a TCP port');
  browser = await chromium.launch({
    headless: true,
    args: ['--enable-precise-memory-info'],
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  });
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.error(`[page] ${error.message}`));
  await page.goto(`http://127.0.0.1:${address.port}/test/browser-gates/`);
  await page.waitForFunction(() => globalThis.__postcssGoGates?.status !== 'pending', null, {
    timeout: 180_000,
  });
  report = await page.evaluate(() => globalThis.__postcssGoGates);
} finally {
  await browser?.close();
  await server.close();
}

if (report.status !== 'passed') {
  console.error(report.stack ?? report.message);
  throw new Error(`browser gate harness failed: ${report.message}`);
}

const wasm = readFileSync(resolve(packageRoot, 'dist/wasm/postcss-go.wasm'));
const assets = {
  wasmBytes: wasm.length,
  wasmGzipBytes: gzipSync(wasm).length,
  baselineWasmGzipBytes: JSON.parse(
    readFileSync(resolve(packageRoot, 'test/browser-gates/asset-baseline.json'), 'utf8'),
  ).wasmGzipBytes,
};
const memoryMeasured = Boolean(report.handle.peakMemoryBytes && report.worker.peakMemoryBytes);
const pairs = [
  ['startup', report.handle.bootMs, report.worker.bootMs],
  ['median process', report.handle.medianProcessMs, report.worker.medianProcessMs],
  ['compressed wasm', assets.wasmGzipBytes, assets.baselineWasmGzipBytes],
];
if (memoryMeasured) {
  pairs.push(['peak memory', report.handle.peakMemoryBytes, report.worker.peakMemoryBytes]);
} else {
  console.error(
    `warning: total memory is unmeasurable in this browser; main-thread mode holds ` +
      `${report.handle.wasmInstances} Go/WASM instances versus ${report.worker.wasmInstances}`,
  );
}

const gates = pairs.map(([name, candidate, baseline]) => {
  const ratio = baseline > 0 ? candidate / baseline : Number.NaN;
  return {
    name,
    ratio: Number(ratio.toFixed(3)),
    limit: LIMITS[name],
    passed: ratio <= LIMITS[name],
  };
});

console.log(
  JSON.stringify(
    {
      iterations: report.iterations,
      crossOriginIsolated: report.crossOriginIsolated,
      memoryMeasured,
      workerOnly: report.worker,
      mainThreadHandle: report.handle,
      assets,
      gates,
    },
    null,
    2,
  ),
);

const failed = gates.filter((gate) => !gate.passed);
if (failed.length > 0 && !process.argv.includes('--report-only')) {
  throw new Error(
    `Phase 8 gates failed: ${failed
      .map((gate) => `${gate.name} ${gate.ratio.toFixed(3)}x > ${gate.limit}x`)
      .join(', ')}. Ship with mainThreadAst: false until resolved.`,
  );
}
