# postcss-go

`postcss-go` is a Go port of the core [PostCSS](https://github.com/postcss/postcss) architecture.

The repository mirrors the same high-level pipeline as upstream PostCSS:

1. `tokenizer` turns CSS into tokens
2. `parser` turns tokens into an AST
3. `processor` runs visitor-style plugins on the AST
4. `stringifier` turns the AST back into CSS

Today the Go engine is already usable for parsing, AST mutation, walking, stringifying, and source map generation. The surrounding Node.js workspace provides a compatible CLI, upstream compatibility harnesses, and the in-progress bridge layers for future JS and browser runtimes.

## Status

Implemented today:

- Go tokenizer, parser, AST, processor, and stringifier
- Visitor-style plugin execution with enter/exit hooks (including named at-rule / declaration prop hooks)
- Go facade API under `internal/postcss` for parsing, processing, walking, and warnings
- Source map generation and previous-map composition in the Go processor
- A Node.js CLI aligned with [postcss-cli](https://github.com/postcss/postcss-cli)
- Upstream compatibility checks against a vendored copy of `postcss/postcss`
- Benchmark tooling for comparing the Go engine with upstream PostCSS

Still in progress:

- Full `lazy-result` / async plugin behavior
- `raws` and formatting fidelity comparable to upstream PostCSS
- Full source map option / annotation parity with upstream
- A production-ready JS bridge and wasm/browser runtime
- Closer tokenizer/parser edge-case parity with upstream

## Packages

| Package              | Path                       | Role                                   |
| -------------------- | -------------------------- | -------------------------------------- |
| `@postcss-go/cli`    | `packages/postcss-go-cli`  | CLI (postcss-cli compatible)           |
| `@postcss-go/core`   | `packages/postcss-go`      | Node.js / TypeScript API surface       |
| `@postcss-go/compat` | `packages/postcss-compat`  | Upstream test harness and Go overrides |
| `@postcss-go/wasm`   | `packages/postcss-go-wasm` | Browser / worker / wasm entry skeleton |

## CLI

Process CSS files from the command line (compatible with [postcss-cli](https://github.com/postcss/postcss-cli) options):

```bash
pnpm install
pnpm --filter @postcss-go/cli test

# Go engine (JS plugin chains + Go parse/stringify and source maps)
node packages/postcss-go-cli/index.js input.css -o output.css
```

See [packages/postcss-go-cli/README.md](packages/postcss-go-cli/README.md) for full usage.

## Go API

Use the Go processor directly when you want to parse CSS, mutate the AST, and stringify the result in-process. The facade lives at `postcss-go/internal/postcss`:

## Example

```go
package main

import (
	"fmt"

	postcss "postcss-go/internal/postcss"
)

func main() {
	processor := postcss.New(
		postcss.Plugin{
			Name: "rewrite",
			Visitor: postcss.Visitor{
				Declaration: func(decl *postcss.Declaration, result *postcss.Result) error {
					if decl.Prop == "color" && decl.Value == "red" {
						decl.Value = "tomato"
					}
					return nil
				},
			},
		},
	)

	result, err := processor.Process(".btn { color: red; }", postcss.ProcessOptions{
		From: "input.css",
		To:   "output.css",
		Map:  true,
	})
	if err != nil {
		panic(err)
	}

	fmt.Println(result.CSS)
}
```

The facade also exposes lower-level helpers such as:

- `Parse` / `ParseWithOptions`
- `Stringify`
- `NewRoot`, `NewRule`, `NewAtRule`, `NewDeclaration`, `NewComment`
- `NewInput`
- `Walk`, `WalkRules`, `WalkAtRules`, `WalkDecls`, `WalkComments`

## Visitor Hooks

Currently supported hooks:

- `Once`
- `OnceExit`
- `Root` / `RootExit`
- `Rule` / `RuleExit`
- `AtRule` / `AtRuleExit`
- `AtRuleNamed` / `AtRuleExitNamed`
- `Declaration` / `DeclarationExit`
- `DeclarationProp` / `DeclarationExitProp`
- `Comment` / `CommentExit`

`Plugin.Prepare` is also supported, which lets a plugin create a per-run visitor from the current `Result`.

## Current limitations

This version is closer to the upstream architecture than the initial simplified implementation, but the port is not complete:

- No Go-native `lazy-result` / async plugin pipeline yet
- No `raws` or faithful formatting output yet
- Source maps work for common cases, but option / annotation parity with upstream is still incomplete
- The CLI runs JS PostCSS plugin chains before parse/stringify through the Go bridge
- JS/TS `packages/` are still bridge layers in progress rather than a finished runtime surface
- parser / tokenizer still need to be aligned further with upstream behavior

## Development

Install workspace dependencies:

```bash
pnpm install
```

Common local workflows:

```bash
pnpm test:go
pnpm test
pnpm check
pnpm check:all
pnpm bench
```

## Verification

```bash
pnpm test:go
pnpm check
pnpm check:all
```

Upstream PostCSS compatibility:

```bash
pnpm check:upstream      # fail if vendor/postcss is stale
pnpm sync:upstream       # refresh vendor/postcss from postcss/postcss@main
pnpm test:upstream       # run full vendored PostCSS unit suite
pnpm test:upstream:go    # run Go compat tokenizer subset
```

See [packages/postcss-compat/overrides/go/README.md](packages/postcss-compat/overrides/go/README.md) for the current Go-backed override status.

## Benchmark vs postcss

Compare core parse/stringify/process performance against upstream [postcss/postcss](https://github.com/postcss/postcss):

```bash
pnpm install
pnpm bench
```

Benchmarks cover synthetic scaling workloads and real-world CSS fixtures (modern-normalize, Tailwind preflight, animate.css, Bootstrap). See [docs/benchmark.md](docs/benchmark.md) for workload details and individual commands.

GitHub Actions CI runs these lanes:

- Upstream snapshot: verify `vendor/postcss/` matches `postcss/postcss@main`
- Benchmark comparison: run `pnpm bench` and publish the benchmark report as a CI summary/artifact
- Format, lint, and build: `prettier --check`, `eslint`, `gofmt`, `go vet`, and `pnpm build`
- Node / TypeScript tests on Ubuntu, macOS, and Windows
- Upstream tests: full vendored PostCSS unit suite plus Go compat tokenizer subset
- Go tests on Ubuntu, macOS, and Windows

A scheduled workflow (`.github/workflows/upstream-postcss-sync.yml`) opens a PR when upstream tests change.

## Acknowledgements

[PostCSS](https://github.com/postcss/postcss) by [Andrey Sitnik](https://github.com/ai) is the upstream project this repository ports to Go. The Go engine follows PostCSS's core pipeline (`tokenizer` → `parser` → `AST` → `processor` → `stringifier`), and `vendor/postcss/` contains a vendored copy of the upstream test suite used for compatibility checks.

Related PostCSS projects used by the Node.js packages:

- [postcss-cli](https://github.com/postcss/postcss-cli) — CLI interface and options in `packages/postcss-go-cli/`
- [postcss-load-config](https://github.com/postcss/postcss-load-config) — `postcss.config.js` loading
- [postcss-reporter](https://github.com/postcss/postcss-reporter) — CLI warning output formatting

PostCSS is released under the [MIT License](https://github.com/postcss/postcss/blob/main/LICENSE). This project is an independent port and is not affiliated with or endorsed by the PostCSS project.
