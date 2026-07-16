# Go compat overrides

Files in this directory replace matching modules under `vendor/postcss/lib/`
when `POSTCSS_COMPAT_MODE=go`.

## Current status

| Module         | Backend                    | Notes                                                     |
| -------------- | -------------------------- | --------------------------------------------------------- |
| `tokenize.js`  | Upstream JS (compat entry) | Go tokenizer is implemented in `internal/tokenizer`      |
| `parse.js`     | Upstream JS                | `postcss-parser-tests` fixtures need full `raws` fidelity |
| `stringify.js` | Upstream JS                | Go `stringify` RPC available for DTO payloads             |
| `processor.js` | Upstream JS                | Async/lazy plugin model not ported yet                    |

The Go engine is validated directly via `go test` and `pnpm test:upstream:go` runs the
upstream tokenizer suite through this compat entry point.
