# Merge Tokenize and Tokenizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `internal/tokenizer` the only CSS tokenizer implementation, adapt jsbridge to it without changing its wire format, and remove `internal/tokenize`.

**Architecture:** Replace the community lexer-backed tokenizer with one structured-token implementation based on the existing PostCSS-compatible scanner behavior. The parser consumes `tokenizer.Token` directly, while jsbridge converts those tokens to the existing legacy `[]any` response shape at its boundary.

**Tech Stack:** Go 1.25, Go testing, `internal/source`, `internal/csserrors`, jRPC2, existing jsbridge tests.

## Global Constraints

- Keep `internal/tokenizer` as the only tokenizer package.
- Keep `Token{Kind, Start, End}` as the only internal token representation.
- Preserve jsbridge RPC method names, request fields, and legacy array token JSON shape.
- Preserve parser output, source ranges, pushback, EOF, position, and unclosed-input behavior.
- Do not modify unrelated existing worktree changes in `packages/postcss-go-cli/test/watch.ts`.
- Use test-first changes: each production behavior change requires a failing test before implementation.

---

### Task 1: Define the unified tokenizer API and compatibility tests

**Files:**
- Modify: `internal/tokenizer/tokenizer.go`
- Modify: `internal/tokenizer/tokenizer_test.go`
- Modify: `internal/parser/parser.go`

**Interfaces:**
- Produces `tokenizer.Options`, `tokenizer.NextOptions`, `New(input string, opts Options) *Tokenizer`, `Next(opts NextOptions) (Token, error)`, `Back(Token)`, `Position() int`, and `EOF() bool`.
- Keeps `Token.Text(string) string` unchanged.

- [ ] **Step 1: Add failing API and behavior tests**

Add tests for the options-aware constructor and next method, PostCSS-compatible token ranges, position queries, and UTF-16 error positions. The tests should call:

```go
tok := New(`"unterminated`, Options{})
_, err := tok.Next(NextOptions{})
```

and assert the error contains `Unclosed string` with the expected line and UTF-16 column. Add a test that `New("Three tokens", Options{}).Position()` advances to `5`, `6`, and `12` after successive tokens. Add coverage for `IgnoreUnclosed` returning a token instead of an error.

- [ ] **Step 2: Run the focused tests and verify the intended failure**

Run:

```bash
go test ./internal/tokenizer -run 'TestTokenizer(Options|Position|UTF16|IgnoreUnclosed)'
```

Expected: FAIL because the current constructor and `Next` signatures do not accept options and the new compatibility behavior is not implemented.

- [ ] **Step 3: Commit the red tests**

```bash
git add internal/tokenizer/tokenizer_test.go
git commit -m "test: define unified tokenizer contract"
```

### Task 2: Implement the unified PostCSS-compatible scanner

**Files:**
- Modify: `internal/tokenizer/tokenizer.go`
- Modify: `internal/tokenizer/tokenizer_test.go`

**Interfaces:**
- Consumes the API defined in Task 1.
- Produces structured tokens with `Kind`, byte offsets in `Start`/`End`, and text recovered by `Token.Text`.

- [ ] **Step 1: Add failing coverage for token categories and edge cases**

Add table-driven tests for empty input, whitespace, words split at `!`, controls (`{ : ; }`), at-words, comments, quoted strings, `url(foo)`, ordinary parentheses, escapes, UTF-8 text, and unclosed string/comment/bracket errors. Keep expectations in structured-token form:

```go
Token{Kind: "word", Start: 0, End: 1}
Token{Kind: "{", Start: 0, End: 0}
```

- [ ] **Step 2: Run the category tests to verify they expose missing behavior**

Run:

```bash
go test ./internal/tokenizer -run 'TestTokenizer(Empty|Space|Word|Control|AtWord|Comment|String|URL|Escape|UTF8|Errors)'
```

Expected: FAIL for at least the cases where the community lexer groups tokens differently or reports errors with the wrong classification/position.

- [ ] **Step 3: Replace the lexer-backed implementation with one scanner**

Implement the scanner in `internal/tokenizer/tokenizer.go` using byte offsets and UTF-8 rune decoding. Preserve these rules:

```go
type Options struct { IgnoreErrors bool }
type NextOptions struct { IgnoreUnclosed bool }

func New(input string, opts Options) *Tokenizer
func (t *Tokenizer) Next(opts NextOptions) (Token, error)
```

The scanner must maintain a pushback stack, a current byte position, the prior token buffer needed to recognize unquoted `url(...)`, and the last malformed-parenthesis boundary. Use `source.Input` or an equivalent local error helper so errors retain the repository's line/column format and UTF-16 columns. Remove the `tdewolff/parse/v2` imports from this file.

- [ ] **Step 4: Run focused tests and the parser package**

Update parser construction and consumption to use the unified options-aware API:

```go
tok: tokenizer.New(css, tokenizer.Options{})
token, err := p.tok.Next(tokenizer.NextOptions{})
```

Keep parser error propagation and token range handling unchanged.

Run:

```bash
go test ./internal/tokenizer ./internal/parser
```

Expected: PASS, with existing parser tests confirming that structured token ranges still produce the same AST.

- [ ] **Step 5: Commit the unified scanner**

```bash
git add internal/tokenizer/tokenizer.go internal/tokenizer/tokenizer_test.go internal/parser/parser.go
git commit -m "refactor: unify tokenizer scanning behavior"
```

### Task 3: Adapt jsbridge to structured tokens without changing RPC output

**Files:**
- Modify: `internal/jsbridge/tokenize.go`
- Modify: `internal/jsbridge/bridge_test.go` or create: `internal/jsbridge/tokenize_test.go`

**Interfaces:**
- Consumes `tokenizer.New`, `tokenizer.Options`, `tokenizer.NextOptions`, `tokenizer.Token`, and `Token.Text`.
- Produces the unchanged `TokenizeNextResult.Token []any` JSON payload and existing RPC handlers.

- [ ] **Step 1: Add failing bridge compatibility tests**

Test `TokenizeOpenRPC`, `TokenizeNextRPC`, `TokenizeBackRPC`, `TokenizePositionRPC`, `TokenizeEOFRPC`, and `TokenizeCloseRPC` with CSS such as `@media { color: red; }`. Assert that next responses still contain legacy arrays such as `[]any{"at-word", "@media", 0, 5}` and that back, position, EOF, and unknown-session behavior remain unchanged.

- [ ] **Step 2: Run the bridge tests and verify the intended failure**

Run:

```bash
go test ./internal/jsbridge -run 'TestTokenize'
```

Expected: FAIL because the bridge still constructs `tokenize.Processor` and the old package has not yet been removed.

- [ ] **Step 3: Implement the bridge adapter**

Change the session processor to `*tokenizer.Tokenizer`, change request option types to `tokenizer.Options` and `tokenizer.NextOptions`, and convert structured tokens to the legacy response shape using the original CSS input:

```go
func legacyToken(input string, token tokenizer.Token) []any {
    if token.Kind == "space" {
        return []any{"space", token.Text(input)}
    }
    if token.Kind == "word" || token.Kind == "at-word" || token.Kind == "comment" || token.Kind == "brackets" || token.Kind == "string" {
        return []any{token.Kind, token.Text(input), token.Start, token.End}
    }
    return []any{token.Kind, token.Text(input), token.Start}
}
```

Store the CSS string in the session so conversion does not duplicate token text in the tokenizer.

- [ ] **Step 4: Run bridge and full Go tests**

Run:

```bash
go test ./internal/jsbridge ./...
```

Expected: PASS and unchanged RPC compatibility tests.

- [ ] **Step 5: Commit the bridge migration**

```bash
git add internal/jsbridge/tokenize.go internal/jsbridge/tokenize_test.go internal/jsbridge/bridge_test.go
git commit -m "refactor: route tokenizer bridge through unified tokenizer"
```

### Task 4: Remove the duplicate package and unused dependency

**Files:**
- Delete: `internal/tokenize/tokenize.go`
- Delete: `internal/tokenize/tokenize_test.go`
- Modify: `go.mod`
- Modify: `go.sum`
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes the unified tokenizer and bridge from Tasks 1-3.
- Produces a repository with no Go imports or source references to `internal/tokenize`.

- [ ] **Step 1: Add a repository reference test/check**

Use the existing package build as the failing check after removing the old package; before deletion, verify references with:

```bash
rg -n 'internal/tokenize|github.com/tdewolff/parse/v2' --glob '*.go' --glob 'go.mod' --glob 'go.sum' .
```

- [ ] **Step 2: Remove old files and dependency**

Delete both files under `internal/tokenize`, remove `github.com/tdewolff/parse/v2` from `go.mod`, run `go mod tidy`, and update `docs/architecture.md` so it documents the single `internal/tokenizer` layer.

- [ ] **Step 3: Verify no duplicate references remain**

Run:

```bash
rg -n 'internal/tokenize|github.com/tdewolff/parse/v2' --glob '*.go' --glob 'go.mod' --glob 'go.sum' .
```

Expected: no output.

- [ ] **Step 4: Run all verification commands**

Run:

```bash
go test ./...
go vet ./...
git diff --check
```

Expected: all commands exit with status 0; the only pre-existing unrelated worktree change remains `packages/postcss-go-cli/test/watch.ts`.

- [ ] **Step 5: Commit the package removal**

```bash
git add internal/tokenize go.mod go.sum docs/architecture.md
git commit -m "refactor: remove duplicate tokenize package"
```
