import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, expect, test } from 'vitest';

type SmokeStatus = {
  status: 'pending' | 'passed' | 'failed';
  mapFile?: string;
  name?: string;
  message?: string;
};

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = resolve(packageRoot, '../..');
const { chromium } = await import(
  createRequire(resolve(repoRoot, 'package.json')).resolve('playwright')
);

let origin = '';
let server: ViteDevServer;

beforeAll(async () => {
  server = await createServer({
    root: packageRoot,
    logLevel: 'warn',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not expose a TCP port');
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await server?.close();
});

test('browser WASM worker processes CSS through the published wasm entry', async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  });
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/test/browser-smoke/`);
    await page.waitForFunction(
      () =>
        (globalThis as typeof globalThis & { __postcssGoWasmSmoke?: SmokeStatus })
          .__postcssGoWasmSmoke?.status !== 'pending',
      null,
      { timeout: 30_000 },
    );
    const result = await page.evaluate(
      () =>
        (globalThis as typeof globalThis & { __postcssGoWasmSmoke?: SmokeStatus })
          .__postcssGoWasmSmoke,
    );
    expect(result?.status, JSON.stringify(result)).toBe('passed');
  } finally {
    await browser.close();
  }
});
