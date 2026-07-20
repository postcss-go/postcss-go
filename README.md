# postcss-go

[![CI](https://github.com/eryue0220/postcss-go/actions/workflows/ci.yml/badge.svg)](https://github.com/eryue0220/postcss-go/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **Experimental:** `postcss-go` is not production-ready. APIs and behavior may change.

## Overview

`postcss-go` is a Go port of the core [PostCSS](https://github.com/postcss/postcss) architecture. It provides CSS parsing, AST transformation, processing, stringifying, and source map support, with Node.js packages for CLI and runtime integration.

## Goals

- Be faster than PostCSS for common parse, transform, and stringify workloads.
- Stay compatible with the existing PostCSS ecosystem, including plugins and surrounding tooling.

## Packages

| Package              | Path                       | Role                                          |
| -------------------- | -------------------------- | --------------------------------------------- |
| `@postcss-go/core`   | `packages/postcss-go`      | Node.js / TypeScript API and `postcss-go` CLI |
| `@postcss-go/compat` | `packages/postcss-compat`  | Upstream compatibility harness                |
| `@postcss-go/wasm`   | `packages/postcss-go-wasm` | Browser / worker / wasm entry point           |

## CLI

```bash
pnpm install
node packages/postcss-go/bin/postcss-go.js input.css -o output.css
```

See [packages/postcss-go/README.md](packages/postcss-go/README.md) for CLI options and examples.

## Go API

```go
package main

import (
	"fmt"

	postcss "postcss-go/internal/postcss"
)

func main() {
	root, err := postcss.Parse(".btn { color: red; }")
	if err != nil {
		panic(err)
	}

	postcss.WalkDecls(root, func(decl *postcss.Declaration) error {
		if decl.Prop == "color" && decl.Value == "red" {
			decl.Value = "tomato"
		}
		return nil
	})

	fmt.Println(postcss.Stringify(root))
}
```

## Documentation

- [Architecture](docs/architecture.md)
- [Contributing](docs/contributing.md)

## License

[MIT](LICENSE)

## Acknowledgements

`postcss-go` is an independent Go port of [PostCSS](https://github.com/postcss/postcss) by [Andrey Sitnik](https://github.com/ai), and is not affiliated with or endorsed by the PostCSS project.

Related projects:

- [postcss-cli](https://github.com/postcss/postcss-cli)
- [postcss-load-config](https://github.com/postcss/postcss-load-config)
- [postcss-reporter](https://github.com/postcss/postcss-reporter)
