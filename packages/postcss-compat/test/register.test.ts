import path from 'node:path';
import { createRequire } from 'node:module';
import { expect, test } from 'vitest';

const require = createRequire(import.meta.url);

test('register.cjs points ts-node at the upstream tsconfig', () => {
  delete process.env.TS_NODE_PROJECT;

  const registerPath = require.resolve('../register.cjs');
  delete require.cache[registerPath];
  require(registerPath);

  expect(process.env.TS_NODE_PROJECT).toBe(
    path.join(path.dirname(registerPath), 'tsconfig.upstream.json'),
  );
});
