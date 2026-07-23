# Go compat overrides

TypeScript sources in this directory compile to CommonJS under `../dist/`.
Those `.js` files replace matching modules under `vendor/postcss/lib/` when
`POSTCSS_COMPAT_MODE=go` (via `scripts/prepare-upstream-compat.mjs`).

Upstream test runs copy the vendored tree into a temp directory first, so
overrides are applied only for that run and do not rewrite `vendor/postcss/lib/`.

## Current overrides

| File               | What it is today                                                        | Go side                                                                   |
| ------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `tokenize.ts`      | PostCSS-compatible stateful wrapper around a Go token snapshot          | `internal/tokenizer` + `tokenize` single-request RPC via `bridge-client.cjs` |

`parse.ts` and `stringify.ts` route the public upstream entry points through the
Go JSON-RPC bridge. Parsed DTOs are hydrated into the vendored PostCSS node
classes, preserving the normal upstream node API.

The internal `processor.js` module remains vendored JS. Public stringify calls,
including calls made with PostCSS's builder callback, are handled by the Go
stringifier. Builder mode returns Go-generated chunks with node and `start`/`end`
metadata, which the compatibility layer forwards to the PostCSS callback contract.

## Related Go surface

| Capability | Status                                                                   |
| ---------- | ------------------------------------------------------------------------ |
| Tokenizer  | Implemented in `internal/tokenizer`; compat `tokenize` batch RPC returns UTF-16 offsets in one pass, and the long-lived API exposes `tokenize.open/next/...` |
| Parse      | `parse.ts` override calls jsbridge `parse` and hydrates PostCSS classes  |
| Stringify  | `stringify.ts` override calls jsbridge `stringify` with AST DTOs; builder callbacks receive Go-generated chunks and node metadata |
| Process    | jsbridge `process` RPC available; async/lazy plugin model not ported     |

## Validation

- Go engine: `go test ./...`
- Build overrides: `pnpm --filter @postcss-go/compat build`
- Full upstream compatibility suite with this override applied: `pnpm test:upstream:go`
