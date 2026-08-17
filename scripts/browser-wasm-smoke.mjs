import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, '../packages/postcss-go');
const packageRequire = createRequire(resolve(packageRoot, 'package.json'));
const { createServer } = await import(packageRequire.resolve('vite'));

const server = await createServer({
  root: packageRoot,
  logLevel: 'warn',
  server: { host: '127.0.0.1', port: 0, strictPort: false },
});

let browser;
try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not expose a TCP port');

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/test/browser-smoke/`);
  await page.waitForFunction(() => globalThis.__postcssGoWasmSmoke?.status !== 'pending', null, {
    timeout: 30_000,
  });
  const result = await page.evaluate(() => globalThis.__postcssGoWasmSmoke);
  if (result?.status !== 'passed') {
    throw new Error(`Browser WASM smoke failed: ${JSON.stringify(result)}`);
  }
  console.log('Browser WASM smoke passed');
} finally {
  await browser?.close();
  await server.close();
}
