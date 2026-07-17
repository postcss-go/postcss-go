# Go compat overrides

`.js` files in this directory replace matching modules under `vendor/postcss/lib/`
when `POSTCSS_COMPAT_MODE=go` (via `scripts/prepare-upstream-compat.sh`).
Non-JS files (such as this README) are ignored by the prepare script.

Upstream test runs copy the vendored tree into a temp directory first, so
overrides are applied only for that run and do not rewrite `vendor/postcss/lib/`.

## Current overrides

| File          | What it is today                                                                 | Go side                                                                 |
| ------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `tokenize.js`  | Upstream-compatible JS tokenizer (not yet routed through the Go bridge)          | `internal/tokenizer` + jsbridge `tokenize.*` RPCs via `bridge-client.cjs` |

No `parse.js`, `stringify.js`, or `processor.js` overrides exist yet. In `go`
mode those modules stay as the vendored upstream JS.

## Related Go surface (not wired into overrides yet)

| Capability   | Status                                                                 |
| ------------ | ---------------------------------------------------------------------- |
| Tokenizer    | Implemented in `internal/tokenizer`; exposed as `tokenize.open/next/...` |
| Parse        | jsbridge `parse` RPC available; needs full PostCSS `raws` fidelity     |
| Stringify    | jsbridge `stringify` RPC available for DTO payloads                    |
| Process      | jsbridge `process` RPC available; async/lazy plugin model not ported   |

## Validation

- Go engine: `go test ./...`
- Upstream tokenizer suite with this override applied: `pnpm test:upstream:go`
- Upstream parse suite (still vendored JS parse): `pnpm --filter @postcss-go/compat test:upstream:go:parse`
