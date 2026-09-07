import assert from 'node:assert/strict';

export function summarize(results) {
  for (const mode of ['binary', 'handle']) {
    assert.ok(Array.isArray(results[mode]), `${mode} samples are required`);
    assert.ok(results[mode].length >= 5, 'At least five isolated samples are required');
    for (const row of results[mode]) {
      assert.ok(Number.isFinite(row.ms) && row.ms > 0);
      assert.ok(Number.isFinite(row.rss) && row.rss > 0);
    }
  }
  assert.equal(
    results.binary.length,
    results.handle.length,
    'binary and handle sample counts must match',
  );
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const timeRatio =
    median(results.handle.map((x) => x.ms)) / median(results.binary.map((x) => x.ms));
  const rssRatio =
    Math.max(...results.handle.map((x) => x.rss)) / Math.max(...results.binary.map((x) => x.rss));
  const spread = Object.fromEntries(
    Object.entries(results).map(([mode, rows]) => [
      mode,
      Math.max(...rows.map((x) => x.ms)) / Math.min(...rows.map((x) => x.ms)),
    ]),
  );
  const stable = Object.values(spread).every((ratio) => ratio <= 1.2);
  return {
    timeRatio,
    rssRatio,
    spread,
    stable,
    pass: stable && timeRatio <= 1.05 && rssRatio <= 1.1,
  };
}
