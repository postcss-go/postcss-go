import assert from 'node:assert/strict';

export function summarize(results) {
  assert.ok(Array.isArray(results.samples), 'samples are required');
  assert.ok(results.samples.length >= 5, 'At least five isolated samples are required');
  for (const row of results.samples) {
    assert.ok(Number.isFinite(row.ms) && row.ms > 0);
    assert.ok(Number.isFinite(row.rss) && row.rss > 0);
  }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const ms = results.samples.map((x) => x.ms);
  const rss = results.samples.map((x) => x.rss);
  const spread = Math.max(...ms) / Math.min(...ms);
  const stable = spread <= 1.2;
  return {
    medianMs: median(ms),
    peakRss: Math.max(...rss),
    spread,
    stable,
    pass: stable,
  };
}
