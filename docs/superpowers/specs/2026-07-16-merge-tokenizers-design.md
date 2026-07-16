# Merge Tokenize and Tokenizer Design

## Goal

Keep `internal/tokenizer` as the repository's only CSS tokenizer implementation, remove the duplicate `internal/tokenize` package, and preserve parser behavior and the existing jsbridge RPC JSON protocol.

## Current State

The repository currently contains two independent implementations:

- `internal/tokenize` uses the PostCSS-style `Processor`, `Input`, and `[]any` token representation. It supports the tokenizer bridge, pushback, position queries, ignored errors, and UTF-16 error positions.
- `internal/tokenizer` uses the structured `Token{Kind, Start, End}` representation. It is used by `internal/parser` and currently depends on `github.com/tdewolff/parse/v2`.

Both implementations scan CSS independently, which duplicates maintenance, behavior, and error-handling logic.

## Architecture

Keep `internal/tokenizer` and migrate the valuable behavior from `internal/tokenize` into it. The unified data flow is:

```text
CSS string
    |
    v
internal/tokenizer.Tokenizer
    |
    +--> internal/parser consumes structured Token directly
    |
    +--> internal/jsbridge converts structured Token to legacy []any JSON token
```

The unified internal token type is:

```go
type Token struct {
    Kind  string
    Start int
    End   int
}
```

`Token.Text(input)` continues to read text from the original CSS by range, so token text is not stored a second time.

`Tokenizer` provides the unified scanning and state API:

```go
type Options struct {
    IgnoreErrors bool
}

type NextOptions struct {
    IgnoreUnclosed bool
}

func New(input string, opts Options) *Tokenizer
func (t *Tokenizer) Next(opts NextOptions) (Token, error)
func (t *Tokenizer) Back(token Token)
func (t *Tokenizer) Position() int
func (t *Tokenizer) EOF() bool
```

The implementation must cover whitespace, ordinary words, at-words, comments, strings, brackets, and control characters, while preserving the existing error categories for unclosed strings, comments, and brackets.

## Compatibility

`internal/parser` continues to consume the unified structured token type from `internal/tokenizer`; no second token type is introduced.

`internal/jsbridge` no longer imports `internal/tokenize`. It keeps the existing RPC method names, request fields, and response JSON shape, and performs the conversion between structured tokens and legacy `[]any` tokens inside the bridge:

```text
structured Token{Kind, Start, End} + input
    -> []any legacy token
```

This keeps the `tokenize.open/next/back/position/eof/close` protocol unchanged for existing JavaScript clients.

After migration, remove:

- `internal/tokenize/tokenize.go`
- `internal/tokenize/tokenize_test.go`
- Any dependency used only by the old tokenizer, after confirming it has no remaining repository references.

## Testing

Testing has three layers:

1. Move applicable behavior tests from the old tokenizer to `internal/tokenizer`, and add coverage for options, error positions, pushback, and position queries.
2. Keep the parser tests and verify that parser output and source ranges remain unchanged.
3. Add jsbridge-level tests that verify the legacy array token JSON shape, pushback, position queries, and EOF behavior.

At minimum, cover empty input, whitespace, ordinary words, at-words, control characters, comments, strings, URLs/brackets, escapes, UTF-8 input, unclosed input, and `IgnoreErrors`/`IgnoreUnclosed`.

Verification commands:

```bash
go test ./...
go vet ./...
```

## Scope Boundaries

This refactor does not change the AST design, rename or redesign jsbridge RPC methods, add new tokenizer features, or refactor modules unrelated to tokenization.
