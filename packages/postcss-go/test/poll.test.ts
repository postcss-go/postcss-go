import { expect, test } from 'vitest';

import { getPollInterval, usePolling } from '../src/poll.ts';

test('getPollInterval defaults to 100 ms', () => {
  expect(getPollInterval(undefined)).toBe(100);
  expect(getPollInterval(false)).toBe(100);
  expect(getPollInterval(true)).toBe(100);
});

test('getPollInterval parses numeric CLI values', () => {
  expect(getPollInterval(250)).toBe(250);
  expect(getPollInterval('250')).toBe(250);
});

test('getPollInterval falls back for invalid values', () => {
  expect(getPollInterval(0)).toBe(100);
  expect(getPollInterval(-1)).toBe(100);
  expect(getPollInterval('')).toBe(100);
  expect(getPollInterval('nope')).toBe(100);
  expect(getPollInterval(Number.NaN)).toBe(100);
});

test('usePolling enables polling for boolean and numeric values', () => {
  expect(usePolling(false)).toBe(false);
  expect(usePolling(true)).toBe(true);
  expect(usePolling('250')).toBe(true);
});
