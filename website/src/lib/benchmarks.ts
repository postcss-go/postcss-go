export type EngineId = 'postcss-go' | 'postcss' | 'csstree';

export type BenchEngine = {
  id: EngineId;
  label: string;
  href: string;
  /** Wall time in nanoseconds. `null` means the engine has no equivalent API. */
  ns: number | null;
};

export type BenchScenario = {
  id: string;
  label: string;
  caption: string;
  engines: BenchEngine[];
};

const LINKS = {
  'postcss-go': 'https://github.com/eryue0220/postcss-go',
  postcss: 'https://github.com/postcss/postcss',
  csstree: 'https://github.com/csstree/csstree',
} as const;

function engine(id: EngineId, ns: number | null): BenchEngine {
  const labels: Record<EngineId, string> = {
    'postcss-go': 'postcss-go',
    postcss: 'PostCSS',
    csstree: 'CSSTree',
  };
  return { id, label: labels[id], href: LINKS[id], ns };
}

/**
 * Snapshot from Apple M1 Max (darwin/arm64), 19 Aug 2026.
 * Go numbers are the mean of fifteen `testing.B` runs:
 *   go test -mod=mod ./benchmark/ -bench 'Benchmark(ParseReal|ParseStringifyReal|ProcessReal)_Bootstrap$' -benchmem -count=15
 * Node numbers are the mean of seven Bootstrap-only runs using the same
 * warmup (5) and iterations (20) as `benchmark/postcss.bench.mjs` and
 * `benchmark/csstree.bench.mjs` for fixtures ≥ 200 KB.
 *
 * Workload: Bootstrap 5 CSS, 281 KB, no minification.
 */
export const bootstrapScenarios: BenchScenario[] = [
  {
    id: 'parse-stringify',
    label: 'Parse + stringify',
    caption:
      'Parse Bootstrap 5 CSS into a PostCSS-shaped AST and print it back, without minification or source maps.',
    engines: [
      engine('postcss-go', 5_293_539),
      engine('postcss', 8_952_584),
      engine('csstree', 16_398_209),
    ],
  },
  {
    id: 'process',
    label: 'Process',
    caption: 'Parse, walk every node, then stringify with an empty plugin list.',
    engines: [
      engine('postcss-go', 5_662_754),
      engine('postcss', 10_066_365),
      engine('csstree', 18_754_708),
    ],
  },
  {
    id: 'parse',
    label: 'Parse',
    caption: 'Tokenize and parse into a PostCSS-shaped AST only.',
    engines: [
      engine('postcss-go', 4_310_975),
      engine('postcss', 7_592_067),
      engine('csstree', 13_290_273),
    ],
  },
];

export function formatMs(ns: number): string {
  const ms = ns / 1e6;
  if (ms < 10) return `${ms.toFixed(2)} ms`;
  return `${ms.toFixed(1)} ms`;
}

export function relativeToFastest(ns: number, fastest: number): string {
  const ratio = ns / fastest;
  if (ratio <= 1.05) return '1×';
  return `${ratio.toFixed(2)}×`;
}

export function axisMaxMs(nsValues: number[]): number {
  const maxMs = Math.max(...nsValues) / 1e6;
  const steps = [2, 4, 5, 8, 10, 12, 16, 20, 24, 30, 40, 50, 80, 100];
  return steps.find((step) => step >= maxMs * 1.08) ?? Math.ceil(maxMs / 10) * 10;
}
