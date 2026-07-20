# Go compat overrides

`.js` files in this directory replace matching modules under `vendor/postcss/lib/`
when `POSTCSS_COMPAT_MODE=go` (via `scripts/prepare-upstream-compat.mjs`).
Non-JS files (such as this README) are ignored by the prepare script.

Upstream test runs copy the vendored tree into a temp directory first, so
overrides are applied only for that run and do not rewrite `vendor/postcss/lib/`.

## Current overrides

| File          | What it is today                                                        | Go side                                                                   |
| ------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `tokenize.js` | Upstream-compatible JS tokenizer (not yet routed through the Go bridge) | `internal/tokenizer` + jsbridge `tokenize.*` RPCs via `bridge-client.cjs` |

`parse.js` and `stringify.js` route the public upstream entry points through the
Go JSON-RPC bridge. Parsed DTOs are hydrated into the vendored PostCSS node
classes, preserving the normal upstream node API.

The internal `stringifier.js` and `processor.js` modules remain vendored JS:
this compatibility route replaces public parse/stringify, while direct
Stringifier internals and plugin processing retain their upstream contracts.

## Related Go surface

| Capability | Status                                                                   |
| ---------- | ------------------------------------------------------------------------ |
| Tokenizer  | Implemented in `internal/tokenizer`; exposed as `tokenize.open/next/...` |
| Parse      | `parse.js` override calls jsbridge `parse` and hydrates PostCSS classes  |
| Stringify  | `stringify.js` override calls jsbridge `stringify` with AST DTOs         |
| Process    | jsbridge `process` RPC available; async/lazy plugin model not ported     |

## Validation

- Go engine: `go test ./...`
- Upstream tokenizer suite with this override applied: `pnpm test:upstream:go`
- Upstream parse suite through Go parse: `pnpm --filter @postcss-go/compat test:upstream:go:parse`
- Upstream stringify suite through Go parse/stringify: `pnpm test:upstream:go:stringify`
- Root shortcuts: `pnpm test:upstream:go:parse` and `pnpm test:upstream:go:stringify`
