import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarize } from './qualification-metrics.mjs';
const rows = (ms = 1, rss = 100) => Array.from({ length: 5 }, () => ({ ms, rss }));
test('stable samples pass', () => assert.equal(summarize({ samples: rows() }).pass, true));
test('an unstable spread fails', () => {
  const samples = rows();
  samples[4].ms = 10;
  assert.equal(summarize({ samples }).pass, false);
});
test('missing and invalid samples fail closed', () => {
  assert.throws(() => summarize({ samples: [] }));
  assert.throws(() => summarize({ samples: rows().slice(0, 4) }));
  for (const value of [0, -1, NaN, Infinity]) {
    assert.throws(() => summarize({ samples: rows(value) }));
    assert.throws(() => summarize({ samples: rows(1, value) }));
  }
});
