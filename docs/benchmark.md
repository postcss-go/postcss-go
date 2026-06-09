# Benchmark: postcss-go vs postcss

This repository includes a small benchmark suite that compares **postcss-go** (Go) against upstream **[postcss](https://github.com/postcss/postcss)** (Node.js) on the same workloads.

## Workloads

### Synthetic scaling

Deterministic CSS with a fixed number of rules:

| Size   | Rules  |
| ------ | ------ |
| Small  | 10     |
| Medium | 1,000  |
| Large  | 10,000 |

The generator lives in `benchmark/fixtures.go` and is mirrored in `benchmark/postcss.bench.mjs`.

### Real-world CSS fixtures

Vendored stylesheets from common CSS sources (see `benchmark/fixtures/manifest.json`):

| Fixture            | Source                         | ~Size  |
| ------------------ | ------------------------------ | ------ |
| ModernNormalize    | [modern-normalize](https://github.com/sindresorhus/modern-normalize) | 3 KB   |
| TailwindPreflight  | [tailwindcss](https://github.com/tailwindlabs/tailwindcss) preflight | 8 KB   |
| AnimateMin         | [animate.css](https://github.com/animate-css/animate.css) minified | 72 KB  |
| Bootstrap          | [Bootstrap 5](https://github.com/twbs/bootstrap) formatted | 281 KB |
| BootstrapMin       | Bootstrap 5 minified           | 233 KB |

Refresh fixtures:

```bash
pnpm sync:benchmark-fixtures
```

## Scenarios

Three scenarios are measured for each workload:

1. **Parse** — tokenize + parse only
2. **ParseStringify** — parse, then stringify back to CSS
3. **Process** — parse, walk the AST, then stringify (empty plugin list on the Go side; equivalent manual pipeline on the postcss side — upstream `process([])` skips parsing and is not used here)

## Run locally

Install dependencies once:

```bash
pnpm install
```

Print a side-by-side comparison table:

```bash
pnpm bench
```

Run each side separately:

```bash
pnpm bench:go        # Go only
pnpm bench:postcss   # postcss (Node) only
pnpm bench:compare   # both + comparison table
```

Equivalent raw commands:

```bash
go test -mod=mod ./benchmark/ -bench=. -benchmem -count=5
node benchmark/postcss.bench.mjs
node scripts/compare-benchmarks.mjs
```

## Notes

- Results vary by CPU, Go version, and Node version. Treat numbers as directional, not absolute.
- Node benchmarks use a fixed iteration count with warmup; Go uses `testing.B` until stable.
- Real-world fixtures require postcss-go to parse real CSS correctly; `go test ./benchmark/ -run TestRealWorldFixturesParse` verifies this first.
- This compares core parse/stringify/process paths only — not JS plugin execution or source maps.
- postcss-go is still incomplete relative to upstream; benchmark gaps may shrink or grow as the port matures.
