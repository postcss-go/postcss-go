import { expect, test } from 'vitest';

import { getPollInterval, usePolling } from '../lib/poll.js';

test('getPollInterval defaults to 100 ms', () => {
  expect(getPollInterval(undefined)).toBe(100);
  expect(getPollInterval(false)).toBe(100);
  expect(getPollInterval(true)).toBe(100);
});

test('getPollInterval parses numeric CLI values', () => {
  expect(getPollInterval(250)).toBe(250);
  expect(getPollInterval('250')).toBe(250);
});

test('usePolling enables polling for boolean and numeric values', () => {
  expect(usePolling(false)).toBe(false);
  expect(usePolling(true)).toBe(true);
  expect(usePolling('250')).toBe(true);
});
