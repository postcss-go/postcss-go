import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarize } from './qualification-metrics.mjs';
const rows = (ms = 1, rss = 100) => Array.from({ length: 5 }, () => ({ ms, rss }));
test('stable equivalent samples pass', () =>
  assert.equal(summarize({ binary: rows(), handle: rows() }).pass, true));
test('time regression fails', () =>
  assert.equal(summarize({ binary: rows(), handle: rows(1.06) }).pass, false));
test('a peak RSS outlier cannot hide behind the median', () => {
  const handle = rows();
  handle[4].rss = 200;
  assert.equal(summarize({ binary: rows(), handle }).pass, false);
});
test('unstable binary baseline cannot justify a faster handle rollout', () => {
  const binary = rows();
  binary[4].ms = 10;
  assert.equal(summarize({ binary, handle: rows(0.1) }).pass, false);
});
test('missing and invalid samples fail closed', () => {
  assert.throws(() => summarize({ binary: [], handle: rows() }));
  assert.throws(() => summarize({ binary: rows(), handle: rows().slice(0, 4) }));
  assert.throws(() => summarize({ binary: rows(), handle: [...rows(), { ms: 1, rss: 100 }] }));
  for (const value of [0, -1, NaN, Infinity]) {
    assert.throws(() => summarize({ binary: rows(value), handle: rows() }));
    assert.throws(() => summarize({ binary: rows(), handle: rows(1, value) }));
  }
});
