/** Minimal timing helpers shared by the boundary-cost spike scripts. */

const NS_PER_MS = 1e6;

function now() {
  return Number(process.hrtime.bigint());
}

/**
 * Runs `fn` until it has accumulated at least `minMs` of wall time, repeating
 * the whole measurement `samples` times and returning the best (lowest) result.
 * The best sample is the least noisy estimate of the underlying cost.
 */
export function measure(fn, { minMs = 200, samples = 7, warmupMs = 100 } = {}) {
  const warmupEnd = now() + warmupMs * NS_PER_MS;
  while (now() < warmupEnd) fn();

  let best = Infinity;
  let bestIterations = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    let iterations = 0;
    const start = now();
    const deadline = start + minMs * NS_PER_MS;
    let end;
    do {
      fn();
      iterations += 1;
      end = now();
    } while (end < deadline);
    const perOp = (end - start) / iterations;
    if (perOp < best) {
      best = perOp;
      bestIterations = iterations;
    }
  }
  return { ns: best, iterations: bestIterations };
}

/** Same as `measure`, but for operations too slow to loop inside a time budget. */
export function measureSlow(fn, { samples = 9, warmup = 2 } = {}) {
  for (let i = 0; i < warmup; i += 1) fn();
  let best = Infinity;
  for (let sample = 0; sample < samples; sample += 1) {
    const start = now();
    fn();
    const elapsed = now() - start;
    if (elapsed < best) best = elapsed;
  }
  return { ns: best, iterations: 1 };
}

export function formatNs(ns) {
  if (ns < 1_000) return `${ns.toFixed(1)} ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(2)} µs`;
  return `${(ns / 1_000_000).toFixed(2)} ms`;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Renders a titled block explaining what each column of the next table means.
 * `title` may span several lines; `entries` is a list of `[metric, meaning]`.
 */
export function legend(title, entries) {
  const width = Math.max(...entries.map(([metric]) => metric.length));
  const lines = title
    .trim()
    .split('\n')
    .map((line) => line.trim());
  lines.push('');
  for (const [metric, meaning] of entries) {
    lines.push(`  ${metric.padEnd(width)}  ${meaning}`);
  }
  return `${lines.join('\n')}\n`;
}

export function table(rows, columns) {
  const widths = columns.map((column) =>
    Math.max(column.label.length, ...rows.map((row) => String(column.value(row)).length)),
  );
  const line = (cells) =>
    cells
      .map((cell, index) => String(cell).padEnd(widths[index]))
      .join('  ')
      .trimEnd();

  const out = [line(columns.map((column) => column.label))];
  out.push(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of rows) out.push(line(columns.map((column) => column.value(row))));
  return out.join('\n');
}
