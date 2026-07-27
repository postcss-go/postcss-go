# Benchmarks

Two independent suites live in `benchmark/`:

| Suite                                   | Question it answers                                               |
| --------------------------------------- | ----------------------------------------------------------------- |
| [Engine comparison](#engine-comparison) | How fast is the Go engine compared with upstream PostCSS?         |
| [Boundary cost](#boundary-cost)         | Where does time go when an AST crosses between Go and JavaScript? |

Both share the fixtures in `benchmark/fixtures/`.

## Engine comparison

Compares **postcss-go** (Go) against upstream **[postcss](https://github.com/postcss/postcss)** (Node.js) on the same workloads.

### Workloads

#### Synthetic scaling

Deterministic CSS with a fixed number of rules:

| Size   | Rules  |
| ------ | ------ |
| Small  | 10     |
| Medium | 1,000  |
| Large  | 10,000 |

The generator lives in `benchmark/fixtures.go` and is mirrored in `benchmark/postcss.bench.mjs` and `benchmark/boundary/lib/fixtures.mjs`.

#### Real-world CSS fixtures

Vendored stylesheets from common CSS sources (see `benchmark/fixtures/manifest.json`):

| Fixture           | Source                                                               | ~Size  |
| ----------------- | -------------------------------------------------------------------- | ------ |
| ModernNormalize   | [modern-normalize](https://github.com/sindresorhus/modern-normalize) | 3 KB   |
| TailwindPreflight | [tailwindcss](https://github.com/tailwindlabs/tailwindcss) preflight | 8 KB   |
| AnimateMin        | [animate.css](https://github.com/animate-css/animate.css) minified   | 72 KB  |
| Bootstrap         | [Bootstrap 5](https://github.com/twbs/bootstrap) formatted           | 281 KB |
| BootstrapMin      | Bootstrap 5 minified                                                 | 233 KB |

Refresh fixtures:

```bash
pnpm sync:benchmark-fixtures
```

### Scenarios

Three scenarios are measured for each workload:

1. **Parse** — tokenize + parse only
2. **ParseStringify** — parse, then stringify back to CSS
3. **Process** — parse, walk the AST, then stringify (empty plugin list on the Go side; equivalent manual pipeline on the postcss side — upstream `process([])` skips parsing and is not used here)

### Run locally

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
```

Equivalent raw commands:

```bash
go test -mod=mod ./benchmark/ -bench=. -benchmem -count=5
node benchmark/postcss.bench.mjs
node scripts/compare-benchmarks.mjs
```

## Boundary cost

Lives in `benchmark/boundary/`. Today a plugin run can cross the Go↔JS boundary in two ways:

1. **Native sync + binary codec (preferred when the addon builds)** — `packages/postcss-go/native` links a Go c-archive into a Node-API addon. `parse` returns a compact binary AST (`internal/codec`); JavaScript hydrates it with `fromAst`. After plugins run, `toAst` + binary encode feeds `stringify`. Set `POSTCSS_GO_BRIDGE=child` to force the stdio fallback.
2. **Stdio JSON-RPC (fallback)** — the original child-process bridge. Still used when the native addon is unavailable.

The boundary benchmark suite prices each stage so the serialization design can be argued from measurements instead of intuition.

It also prices a single **synchronous** crossing, by building two things that do not otherwise exist in the repo:

- a Node-API addon — Go compiled with `-buildmode=c-archive`, linked into a `.node` through a thin C shim
- a wasip1 reactor module — Go compiled with `//go:wasmexport` and `-buildmode=c-shared`, callable synchronously from Node

Both spike artifacts under `benchmark/boundary/` are isolated in nested modules (`napi/go.mod`, `wasm/go.mod`) so their cgo and WASM code never reaches `go build ./...` or CI. The production native path lives in `cmd/native` + `packages/postcss-go/native`.

### The two halves

The suite measures opposite sides of the same boundary; the commands do not overlap and a full picture needs both.

```bash
pnpm bench:boundary      # JavaScript side + crossing price (~45s)
pnpm bench:boundary:go   # Go side + parser scaling
```

`pnpm bench:boundary` builds the addon and the WASM module, then runs four parts:

| Part | Script             | Measures                                                                   |
| ---- | ------------------ | -------------------------------------------------------------------------- |
| A    | `01-hydration.mjs` | `JSON.parse` / `JSON.stringify`, `fromAst`, `toAst`, and DTO payload sizes |
| B    | `02-napi.mjs`      | NAPI dispatch, the cgo transition, string reads/writes, batching           |
| C    | `03-wasm.mjs`      | The same operations over WASM, plus direct linear-memory reads             |
| D    | `04-verdict.mjs`   | Combines A–C to project a handle-based AST against the current design      |

`pnpm bench:boundary:go` covers the Go side: `ToDTO`, `json.Marshal`, `json.Unmarshal`, and `FromDTO`, each against a compact binary encoding of the same tree (`binary.go`). Because `-bench=.` also runs tests, `TestBinaryCodec` executes too — it asserts the codec round-trips every fixture and prints JSON vs binary payload sizes.

Prerequisites differ:

- `pnpm bench:boundary` needs `packages/postcss-go/dist` and `bin/postcss-go` built (`pnpm build`), a working cgo toolchain, and network access the first time `node-gyp` fetches Node headers.
- `pnpm bench:boundary:go` needs only the Go toolchain.

### Reading the output

- **Part A vs the Go numbers.** The two halves are reported per fixture using the same manifest IDs, so a stage-by-stage total is the sum of both runs.
- **Part D's break-even.** A handle-based AST replaces bulk serialization with many small crossings, so it only wins when one crossing costs less than the per-call break-even Part A reports. Part D repeats the comparison at several plugin counts, because the current design pays once per file while a handle model pays once per pass.
- **Go banners.** `pnpm bench:boundary:go` prints a short `before` / `after` (or metric) banner immediately above each result group, so the raw `go test -bench` lines can be scanned without memorizing stage names. `GoWire` groups JSON (before) against binary (after); `ParseScaling` groups newline-separated (before) against single-line (after).
- **`BenchmarkParseScaling`.** Feeds identical rules with and without newlines. `ns/op` should roughly double as the rule count doubles; where it quadruples instead, parsing is quadratic in input size.
- **`BenchmarkParseThroughput`.** `MB/s` across fixtures. Large gaps between formatted and minified stylesheets of similar size point at newline-sensitive work rather than at raw volume.

To profile the parser:

```bash
go test ./benchmark/boundary/ -run XXX \
  -bench 'BenchmarkParseScaling/single-line/4000' -cpuprofile /tmp/parse.prof
go tool pprof -top -nodecount=15 /tmp/parse.prof
```

### Fixtures

The boundary suite uses `ModernNormalize`, `TailwindPreflight`, `AnimateMin`, and `Bootstrap`, plus a generated 10,000-rule stylesheet. `BootstrapMin` is left out to keep runs short. The Go half resolves fixtures through `benchmark.RealWorldFixtureByID`; the JavaScript half reads the same manifest, so both sides stay on one source of truth.

### Caveats

- Parts A–C are measured. **Part D is a projection**: it multiplies measured per-crossing costs by counted operations rather than running a real handle-based AST, so treat it as a sizing estimate.
- Part D's operation counts come from a modelled "typical plugin" walk, not from a real plugin such as autoprefixer.
- The binary encoder covers only the `raws` keys on the stringifier's hot path, so its payload sizes are a lower bound.
- Build artifacts (`napi/go-out/`, `napi/build/`, `wasm/core.wasm`, `results/`) are gitignored and regenerated by `run-all.mjs`.

## Notes

- Results vary by CPU, Go version, and Node version. Treat numbers as directional, not absolute.
- Node benchmarks use a fixed iteration count with warmup; Go uses `testing.B` until stable.
- Real-world fixtures require postcss-go to parse real CSS correctly; `go test ./benchmark/ -run TestRealWorldFixturesParse` verifies this first.
- The engine comparison covers core parse/stringify/process paths only — not JS plugin execution or source maps.
- postcss-go is still incomplete relative to upstream; benchmark gaps may shrink or grow as the port matures.
