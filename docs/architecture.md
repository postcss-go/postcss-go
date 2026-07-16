# postcss-go Architecture

This repository is not a "PostCSS-inspired simplified implementation." It is a Go port organized around the core modules of `eryue0220/postcss`, with layering inspired by `eryue0220/rslint`.

## Goals

- Align with the core PostCSS data flow: `parse -> AST -> plugin visitors -> stringify`
- Keep the public API thin and push core capabilities into `internal/`
- Structure the repository like `rslint`: layered by responsibility rather than piling logic into a single package

## Layers

- `postcss.go`
  - Public facade exporting `Parse`, `New`, `Stringify`, node types, and walk helpers
- `internal/ast`
  - Node definitions, container operations, traversal
- `internal/tokenizer`
  - The single tokenizer that turns CSS text into a structured token stream
- `internal/parser`
  - Parser that turns a token stream into an AST
- `internal/processor`
  - Visitor-driven plugin execution pipeline
- `internal/result`
  - Processing results and warning collection
- `internal/stringifier`
  - AST -> CSS

## Current status

Phase one is complete:

- A working tokenizer / parser / AST / stringifier loop
- A processor close to the PostCSS visitor model
- Support for `Once / OnceExit / Root / Rule / AtRule / Declaration / Comment` and their `Exit` hooks

Still outstanding:

- `lazy-result` / async plugin model
- `input` / `CssSyntaxError` / source maps / faithful `raws` handling
- More complete node mutation APIs, such as clone, replaceWith, raws, and source line/column
- Tokenizer/parser edge behavior closer to upstream
