# postcss-go

`postcss-go` is a Go port of the core [PostCSS](https://github.com/postcss/postcss) architecture.

The repository mirrors the same high-level pipeline as upstream PostCSS:

1. `tokenizer` turns CSS into tokens
2. `parser` turns tokens into an AST
3. `processor` runs visitor-style plugins on the AST
4. `stringifier` turns the AST back into CSS

Today the Go engine is already usable for parsing, AST mutation, walking, and stringifying CSS. The surrounding Node.js workspace provides a compatible CLI, upstream compatibility harnesses, and the in-progress bridge layers for future JS and browser runtimes.

## Status

Implemented today:

- Go tokenizer, parser, AST, processor, and stringifier
- Visitor-style plugin execution with enter/exit hooks
- Root Go API for parsing, processing, and walking nodes
- A Node.js CLI aligned with [postcss-cli](https://github.com/postcss/postcss-cli)
- Upstream compatibility checks against a vendored copy of `postcss/postcss`
- Benchmark tooling for comparing the Go engine with upstream PostCSS

Still in progress:

- Full `lazy-result` / async plugin behavior
- `raws`, source maps, and formatting fidelity comparable to upstream PostCSS
- A production-ready JS bridge and wasm/browser runtime
- Closer tokenizer/parser edge-case parity with upstream

## CLI

Process CSS files from the command line (compatible with [postcss-cli](https://github.com/postcss/postcss-cli) options):

```bash
pnpm install
pnpm --filter @postcss-go/cli test

# postcss engine (plugins, source maps)
node packages/postcss-go-cli/index.js input.css -o output.css

# go engine (parse/stringify via Go bridge)
node packages/postcss-go-cli/index.js input.css -o output.css --engine go --no-map
```

See [packages/postcss-go-cli/README.md](packages/postcss-go-cli/README.md) for full usage.

## Go API

Use the Go processor directly when you want to parse CSS, mutate the AST, and stringify the result in-process:

## Example

```go
package main

import (
	"fmt"

	postcss "postcss-go"
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

	result, err := processor.Process(".btn { color: red; }")
	if err != nil {
		panic(err)
	}

	fmt.Println(result.CSS)
}
```

The root package also exposes lower-level helpers such as:

- `Parse` / `ParseWithOptions`
- `Stringify`
- `NewRoot`, `NewRule`, `NewAtRule`, `NewDeclaration`, `NewComment`
- `Walk`, `WalkRules`, `WalkAtRules`, `WalkDecls`, `WalkComments`

## Visitor Hooks

Currently supported hooks:

- `Once`
- `OnceExit`
- `Root` / `RootExit`
- `Rule` / `RuleExit`
- `AtRule` / `AtRuleExit`
- `Declaration` / `DeclarationExit`
- `Comment` / `CommentExit`

`Plugin.Prepare` is also supported, which lets a plugin create a per-run visitor from the current `Result`.

## Current limitations

This version is closer to the upstream architecture than the initial simplified implementation, but the port is not complete:

- No `lazy-result` or async plugins yet
- No `raws`, source maps, or faithful formatting output yet
- The `go` CLI engine is currently focused on parse/stringify and does not run PostCSS plugin chains
- JS/TS `packages/` are still bridge layers in progress rather than a finished runtime surface
- parser / tokenizer still need to be aligned further with upstream behavior

## Development

Install workspace dependencies:

```bash
pnpm install
```

Common local workflows:

```bash
go test ./...
pnpm test
pnpm check
pnpm check:all
pnpm bench
```

## Verification

```bash
go test ./...
pnpm check
pnpm check:all
```

Upstream PostCSS compatibility (Phases 1–3):

```bash
pnpm check:upstream      # fail if vendor/postcss is stale
pnpm sync:upstream       # refresh vendor/postcss from postcss/postcss@main
pnpm test:upstream       # run full vendored PostCSS unit suite (652 tests)
pnpm test:upstream:go    # run Go compat tokenizer subset
```

See [docs/upstream-tests.md](docs/upstream-tests.md) for the full upstream test strategy.

## Benchmark vs postcss

Compare core parse/stringify/process performance against upstream [postcss/postcss](https://github.com/postcss/postcss):

```bash
pnpm install
pnpm bench
```

Benchmarks cover synthetic scaling workloads and real-world CSS fixtures (modern-normalize, Tailwind preflight, animate.css, Bootstrap). See [docs/benchmark.md](docs/benchmark.md) for workload details and individual commands.

GitHub Actions CI runs five lanes:

- Upstream snapshot: verify `vendor/postcss/` matches `postcss/postcss@main`
- Benchmark comparison: run `pnpm bench` and publish the benchmark report as a CI summary/artifact
- Upstream tests: full vendored PostCSS unit suite plus Go compat tokenizer subset
- Node / TypeScript: `prettier --check`, `eslint`, workspace typecheck/tests, and `pnpm build`
- Go: `gofmt` verification, `go vet ./...`, and `go test ./...`

A scheduled workflow (`.github/workflows/upstream-postcss-sync.yml`) opens a PR when upstream tests change.

## Acknowledgements

[PostCSS](https://github.com/postcss/postcss) by [Andrey Sitnik](https://github.com/ai) is the upstream project this repository ports to Go. The Go engine follows PostCSS's core pipeline (`tokenizer` → `parser` → `AST` → `processor` → `stringifier`), and `vendor/postcss/` contains a vendored copy of the upstream test suite used for compatibility checks.

Related PostCSS projects used by the Node.js packages:

- [postcss-cli](https://github.com/postcss/postcss-cli) — CLI interface and options in `packages/postcss-go-cli/`
- [postcss-load-config](https://github.com/postcss/postcss-load-config) — `postcss.config.js` loading
- [postcss-reporter](https://github.com/postcss/postcss-reporter) — CLI warning output formatting

PostCSS is released under the [MIT License](https://github.com/postcss/postcss/blob/main/LICENSE). This project is an independent port and is not affiliated with or endorsed by the PostCSS project.
