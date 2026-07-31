# Benchmarks

All benchmark runners, implementations, fixtures, and support code live in
`benchmark/`. There are two independent suites:

| Suite                                   | Question it answers                                               |
| --------------------------------------- | ----------------------------------------------------------------- |
| [Engine comparison](#engine-comparison) | How fast is the Go engine compared with upstream PostCSS?         |
| [Boundary cost](#boundary-cost)         | Where does time go when an AST crosses between Go and JavaScript? |

Both share the fixtures in `benchmark/fixtures/`.

## Engine comparison

Compares **postcss-go** (Go) against upstream
**[postcss](https://github.com/postcss/postcss)** (Node.js) and
the independent CSS engines
**[Lightning CSS](https://github.com/parcel-bundler/lightningcss)**,
**[CSSTree](https://github.com/csstree/csstree)**, and
**[esbuild](https://github.com/evanw/esbuild)** on the same workloads where
their public APIs permit an equivalent comparison.

The Parse scenario also includes parser-only baselines:
**[Lezer CSS](https://github.com/lezer-parser/css)** and
**[Tree-sitter CSS](https://github.com/tree-sitter/tree-sitter-css)**.

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

In addition, `benchmark/stages_bench_test.go` isolates the individual Go
pipeline stages, so a change can be attributed to a single stage instead of the
whole scenario. These are Go-only and have no JavaScript counterpart:

| Conceptual label (oxc-style) | Go / CodSpeed id       | Measures                                                               |
| ---------------------------- | ---------------------- | ---------------------------------------------------------------------- |
| `tokenize[…]`                | `BenchmarkTokenize_*`  | Tokenizer only — drain `Next` until EOF                                |
| `walk[…]`                    | `BenchmarkWalk_*`      | Walk an already-parsed tree (ns/op only; no MB/s)                      |
| `plugin[…]`                  | `BenchmarkPlugin_*`    | Full `Process` with a `display` visitor rewrite (dispatch + stringify) |
| `sourcemap[…]`               | `BenchmarkSourcemap_*` | Full `Process` with source map generation (external map, not inlined)  |

Each stage case is a discrete top-level `Benchmark*` function (for example
`BenchmarkTokenize_bootstrap_css` ↔ `tokenize[bootstrap.css]`). CodSpeed has no
rename alias: changing these ids is a delete+create, so rename in an isolated
PR, merge to `main` to seed the new baseline, then [archive](https://codspeed.io/docs/features/archiving-benchmarks)
the skipped old ids in the CodSpeed UI. Synthetic sizes (`small` / `medium` /
`large`) are 10 / 1,000 / 10,000 rules.

Lightning CSS's Node API exposes parsing and printing together through
`transform()`, without exposing its AST parser or an equivalent PostCSS-style
empty walk. It is therefore included only in **ParseStringify**. The benchmark
sets `minify: false` and does not configure browser targets, CSS Modules, or
bundling. Input strings are converted to `Buffer` before timing because the
Lightning CSS API accepts bytes; the measured operation includes native
parse/print and output allocation.

CSSTree exposes separate parser, walker, and generator APIs, so it participates
in all three scenarios. Source positions are enabled to keep its AST workload
closer to postcss-go and PostCSS. esbuild, like Lightning CSS, exposes CSS
parsing and printing as one transform operation, so it participates only in
**ParseStringify** with minification, source maps, and target lowering disabled.

`@parcel/css` is not included because it re-exports Lightning CSS. SWC's public
CSS package is focused on its minification pipeline, which is not equivalent to
these non-minifying workloads.

Lezer and Tree-sitter produce concrete syntax trees for editor and incremental
parsing use cases. They do not expose equivalent CSS stringifiers, so they
appear in separate parser-only tables and participate only in **Parse**.
Tree-sitter runs through its official WASM runtime for portable CI installation;
each measured operation explicitly deletes the returned tree. The
`tree-sitter-css` package's optional native-runtime peer is satisfied by an npm
alias to `web-tree-sitter`, preventing pnpm from installing the unused native
addon.

### Run locally

Install dependencies once:

```bash
pnpm install
```

Print a side-by-side comparison table:

```bash
pnpm bench
```

`benchmark/run.mjs` is the single engine-comparison runner. To diagnose one
implementation independently, run its underlying command directly:

```bash
go test -mod=mod ./benchmark/ -bench=. -benchmem -count=5
node benchmark/postcss.bench.mjs
node benchmark/lightningcss.bench.mjs
node benchmark/csstree.bench.mjs
node benchmark/esbuild.bench.mjs
node benchmark/lezer.bench.mjs
node benchmark/tree-sitter.bench.mjs
node benchmark/run.mjs
```

### Continuous tracking in CI

The Go engine benchmarks (`benchmark/bench_test.go` and
`benchmark/stages_bench_test.go`) also run on every push to `main` and on every
pull request through [CodSpeed](https://codspeed.io), in
`.github/workflows/codspeed.yml`:

```bash
GOFLAGS='-tags=codspeed' go test ./benchmark/ -bench=.
```

CodSpeed measures them with the
[walltime instrument](https://codspeed.io/docs/instruments/walltime) — the only
instrument supported for Go — and reports per-benchmark differences against the
pull request base. CI builds with `-tags=codspeed`, which excludes
`benchmark/small_bench_test.go` (`*_Small` / `*_small`). Those finish in tens of
microseconds on shared runners and false-trip the default ~10% threshold with no
Go engine change; the CodSpeed Go runner discovers `Benchmark*` from source, so
a `-bench` regex alone is not enough to drop them. Local
`go test -bench=. ./benchmark/` (no `codspeed` tag) still runs the full suite.
Only the Go engine suite is tracked in CI. The cross-engine comparison table
(`pnpm bench`) and the boundary suite stay local / opt-in.

To reproduce a CodSpeed run locally:

```bash
curl -fsSL https://codspeed.io/install.sh | sh
GOFLAGS='-tags=codspeed' codspeed run --mode walltime --skip-upload -- go test ./benchmark/ -bench=.
```

## Boundary cost

Lives in `benchmark/boundary/`. Production plugin runs use one Go↔JS boundary:

1. **Native async + binary codec (default and required)** — `packages/postcss-go/native` links Go into a Node-API addon. Most targets embed a c-archive; Linux musl loads a colocated c-shared companion because musl rejects the Go archive's initial-exec TLS relocations when the addon is opened dynamically. Promise operations run through `napi_async_work`, while explicit `*Sync` APIs use the synchronous exports. Parse returns a compact binary AST (`internal/codec`); after plugins run, binary encoding feeds stringify. A missing compatible async addon is reported instead of silently changing transports.

The boundary benchmark suite compares this with a synthetic JSON DTO baseline,
without retaining a production stdio transport, so the serialization design can
be argued from measurements instead of intuition.

It also prices a single **synchronous** crossing, by building two things that do not otherwise exist in the repo:

- a Node-API addon — Go compiled with `-buildmode=c-archive`, linked into a `.node` through a thin C shim
- a wasip1 reactor module — Go compiled with `//go:wasmexport` and `-buildmode=c-shared`, callable synchronously from Node

Both spike artifacts under `benchmark/boundary/` are isolated in nested modules (`napi/go.mod`, `wasm/go.mod`) so their cgo and WASM code never reaches `go build ./...` or CI. The production native path lives in `internal/nativeaddon`, `internal/nativebridge`, and `packages/postcss-go/native`.

### The two halves

The suite measures opposite sides of the same boundary. The runner executes
both halves by default so a single command produces the full picture:

```bash
pnpm bench:boundary
```

Use `node benchmark/run-boundary.mjs --js-only` or `--go-only` when working on
one half. The JavaScript half builds the addon and the WASM module, then runs
four parts:

| Part | Script             | Measures                                                                   |
| ---- | ------------------ | -------------------------------------------------------------------------- |
| A    | `01-hydration.mjs` | `JSON.parse` / `JSON.stringify`, `fromAst`, `toAst`, and DTO payload sizes |
| B    | `02-napi.mjs`      | NAPI dispatch, the cgo transition, string reads/writes, batching           |
| C    | `03-wasm.mjs`      | The same operations over WASM, plus direct linear-memory reads             |
| D    | `04-verdict.mjs`   | Combines A–C to project a handle-based AST against the current design      |

The Go half covers `ToDTO`, `json.Marshal`, `json.Unmarshal`, and `FromDTO`,
each against a compact binary encoding of the same tree (`binary.go`). Because
`-bench=.` also runs tests, `TestBinaryCodec` executes too — it asserts the
codec round-trips every fixture and prints JSON vs binary payload sizes.

Prerequisites differ:

- The default `pnpm bench:boundary` run needs `packages/postcss-go/dist` and
  the native addon built (`pnpm build`), a working cgo toolchain, and network
  access the first time `node-gyp` fetches Node headers.
- `node benchmark/run-boundary.mjs --go-only` needs only the Go toolchain.

### Reading the output

- **Part A vs the Go numbers.** The two halves are reported per fixture using the same manifest IDs, so a stage-by-stage total is the sum of both runs.
- **Part D's break-even.** A handle-based AST replaces bulk serialization with many small crossings, so it only wins when one crossing costs less than the per-call break-even Part A reports. Part D repeats the comparison at several plugin counts, because the current design pays once per file while a handle model pays once per pass.
- **Go banners.** The Go half prints a short `before` / `after` (or metric)
  banner immediately above each result group, so the raw `go test -bench`
  lines can be scanned without memorizing stage names. `GoWire` groups JSON
  (before) against binary (after); `ParseScaling` groups newline-separated
  (before) against single-line (after).
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
- Build artifacts (`napi/go-out/`, `napi/build/`, `wasm/core.wasm`, `results/`)
  are gitignored and regenerated by `benchmark/run-boundary.mjs`.

## Notes

- Results vary by CPU, Go version, and Node version. Treat numbers as directional, not absolute.
- Node benchmarks use a fixed iteration count with warmup; Go uses `testing.B` until stable.
- Lightning CSS results cover only its public Node `transform()` call with optimization features disabled; they are not pure parser timings.
- esbuild results cover `transformSync()` with the CSS loader and optimization features disabled; they are not pure parser timings.
- Real-world fixtures require postcss-go to parse real CSS correctly; `go test ./benchmark/ -run TestRealWorldFixturesParse` verifies this first.
- The cross-engine comparison covers core parse/stringify/process paths only — not JS plugin execution or source maps. The Go stage benchmarks additionally cover tokenizing, AST walks, a single Go plugin visitor, and source map generation.
- postcss-go is still incomplete relative to upstream; benchmark gaps may shrink or grow as the port matures.
