# Go API

The public Go library lives at `github.com/postcss-go/postcss-go/pkg/api`. It
provides CSS parsing, AST mutation, traversal, stringifying, source maps, and
Go-native plugins.

> **Experimental:** APIs and behavior may change while the project remains in
> v0.

## Requirements

- Go 1.25+

## Install

```bash
go get github.com/postcss-go/postcss-go/pkg/api@v0.0.5
```

## Quick start

```go
package main

import (
	"fmt"
	"log"

	postcss "github.com/postcss-go/postcss-go/pkg/api"
)

func main() {
	root, err := postcss.Parse(".btn { color: red; }")
	if err != nil {
		log.Fatal(err)
	}

	result, err := postcss.New().Process(postcss.Stringify(root), postcss.ProcessOptions{
		From: "input.css",
		To:   "output.css",
	})
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println(result.CSS)
}
```

## Go plugins

Go plugins use the `Plugin` and `Visitor` types. Visitors run during the
processor lifecycle (`Once`, node enter/exit hooks, `OnceExit`).

```go
processor := postcss.New(postcss.Plugin{
	Name: "uppercase-props",
	Visitor: postcss.Visitor{
		Declaration: func(decl *postcss.Declaration, _ *postcss.Result) error {
			decl.Prop = strings.ToUpper(decl.Prop)
			return nil
		},
	},
})

result, err := processor.Process(".btn { color: red; }")
```

## Capabilities

| Capability                 | Go API | npm `@postcss-go/core` |
| -------------------------- | ------ | ---------------------- |
| Parse / stringify          | Yes    | Yes                    |
| Source maps                | Yes    | Yes                    |
| Go-native plugins          | Yes    | No                     |
| JavaScript PostCSS plugins | No     | Yes                    |
| CLI                        | No     | Yes                    |
| Webpack / Vite loaders     | No     | Yes                    |
| Browser WASM               | No     | Yes                    |

## Documentation

- [pkg.go.dev](https://pkg.go.dev/github.com/postcss-go/postcss-go/pkg/api)
- [Architecture](architecture.md)

## Releases

Go module versions use standard semver Git tags (`v0.0.x`) aligned with
`@postcss-go/core` npm releases. The first public Go release is `v0.0.5`.
After a release PR is merged, the release workflow publishes npm packages and
pushes the matching Go tag. If npm has already shipped the version, merging
Go API changes to `main` still pushes the missing Go tag via the Go module
release workflow.
