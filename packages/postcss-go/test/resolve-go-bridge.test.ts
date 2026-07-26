import { afterEach, expect, test } from 'vitest';

import {
  getBundledGoBridgeBinPath,
  resolveGoBridgeServiceOptions,
} from '../src/resolveGoBridge.ts';

const originalBin = process.env.POSTCSS_GO_NODE_API_BIN;

afterEach(() => {
  if (originalBin === undefined) {
    delete process.env.POSTCSS_GO_NODE_API_BIN;
  } else {
    process.env.POSTCSS_GO_NODE_API_BIN = originalBin;
  }
});

test('resolveGoBridgeServiceOptions prefers the POSTCSS_GO_NODE_API_BIN override', () => {
  process.env.POSTCSS_GO_NODE_API_BIN = '/tmp/custom-postcss-go';

  expect(resolveGoBridgeServiceOptions()).toEqual({
    binPath: '/tmp/custom-postcss-go',
  });
});

test('resolveGoBridgeServiceOptions falls back to the bundled binary when no env override exists', () => {
  delete process.env.POSTCSS_GO_NODE_API_BIN;

  expect(resolveGoBridgeServiceOptions()).toEqual({
    binPath: getBundledGoBridgeBinPath(),
    binArgs: ['--single'],
  });
});
