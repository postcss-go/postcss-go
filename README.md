# postcss-go

The goal of `postcss-go` is to port the core architecture of [eryue0220/postcss](https://github.com/eryue0220/postcss) to Go, and organize the repository with the same clear layering as [eryue0220/rslint](https://github.com/eryue0220/rslint).

At the current stage, the main pipeline is in place:

1. `tokenizer` turns CSS into a token stream
2. `parser` turns the token stream into an AST
3. `processor` walks and mutates the AST with visitor-style plugins
4. `stringifier` outputs the AST back to CSS

## Repository layout

- `internal/postcss`: Go-side facade that aggregates AST / parser / processor / stringifier
- `internal/ast`: nodes, containers, traversal
- `internal/tokenizer`: tokenizer
- `internal/parser`: parser
- `internal/processor`: plugin visitor pipeline
- `internal/result`: results and warnings
- `internal/stringifier`: CSS output
- `packages/postcss-go`: Node.js / TypeScript interop entry point
- `packages/postcss-go-cli`: CLI for processing CSS files (ported from [postcss-cli](https://github.com/postcss/postcss-cli))
- `packages/postcss-go-wasm`: browser / worker / wasm entry skeleton
- `docs/architecture.md`: architecture overview

## Workspace

The repository uses `pnpm` to manage the frontend package workspace:

```bash
pnpm install
pnpm build
pnpm check
pnpm check:all
```

At the moment, `packages/` provides package boundaries and type entry points; the Go bridge / wasm runtime are still to be implemented.

The Go side has been consolidated under `internal/` with no root-level public facade; the repository is organized around an internal Go engine with JS/TS packages as the external interface.

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

## Visitor Hooks

Currently supported hooks:

- `Once`
- `OnceExit`
- `Root` / `RootExit`
- `Rule` / `RuleExit`
- `AtRule` / `AtRuleExit`
- `Declaration` / `DeclarationExit`
- `Comment` / `CommentExit`

## Current limitations

This version is closer to the upstream architecture than the initial simplified implementation, but the port is not complete:

- No `lazy-result` or async plugins yet
- No `raws`, source maps, or faithful formatting output yet
- JS/TS `packages/` are still interop skeletons and do not yet bridge to the Go binary or wasm runtime
- parser / tokenizer still need to be aligned further with upstream behavior

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

GitHub Actions CI runs four lanes:

- Upstream snapshot: verify `vendor/postcss/` matches `postcss/postcss@main`
- Upstream tests: full vendored PostCSS unit suite plus Go compat tokenizer subset
- Node / TypeScript: `prettier --check`, `eslint`, workspace typecheck/tests, and `pnpm build`
- Go: `gofmt` verification, `go vet ./...`, and `go test ./...`

A scheduled workflow (`.github/workflows/upstream-postcss-sync.yml`) opens a PR when upstream tests change.
