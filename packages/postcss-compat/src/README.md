# Go compat overrides

TypeScript sources in this directory compile to CommonJS under `../dist/`.
Those `.js` files replace matching modules under `vendor/postcss/lib/` when
`POSTCSS_COMPAT_MODE=go` (via `scripts/prepare-upstream-compat.mjs`).

Upstream test runs copy the vendored tree into a temp directory first, so
overrides are applied only for that run and do not rewrite `vendor/postcss/lib/`.

## Current overrides

| File          | What it is today                                                                                 | Go side                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `tokenize.ts` | PostCSS cursor over a Go UTF-16 token snapshot (`nextToken` / `back` / `position` / `endOfFile`) | `internal/tokenizer` via `tokenize` batch RPC; incremental `tokenize.open/next/...` is also on the same bridge |

`parse.ts` and `stringify.ts` route the public upstream entry points through the
Go JSON-RPC bridge. Parsed DTOs are hydrated into the vendored PostCSS node
classes, preserving the normal upstream node API.

`no-work-result.ts` routes empty-plugin processing through the dedicated Go
`noWork` RPC for identity-map generation, previous-map composition, annotation
cleanup, and annotation emission without parsing CSS. Map helpers
(`applyMapAnnotation`, `normalizeProcessOptions`, `joinMapAnnotationPath`) come
from `postcss-go-shared` (CJS-compatible for the vendored PostCSS tree). Lazy
`.root` access still uses the Go-backed `parse` override.

See `docs/architecture.md` (Source maps) for the JS↔Go ownership split and the
`mapInline` optional-boolean bridge contract.

The internal `processor.js` module remains vendored JS. Public stringify calls,
including calls made with PostCSS's builder callback, are handled by the Go
stringifier. Builder mode returns Go-generated chunks with node and `start`/`end`
metadata, which the compatibility layer forwards to the PostCSS callback contract.

## Related Go surface

| Capability | Status                                                                                                                                                                                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokenizer  | Implemented in `internal/tokenizer`. Compat `tokenize` batch RPC returns UTF-16 offsets, error index, and ignored-unclosed tokens in one pass; the same bridge also exposes `tokenize.open/next/back/position/eof/close`. JS only walks that snapshot to preserve PostCSS's undisposed tokenizer API. |
| Parse      | `parse.ts` override calls jsbridge `parse` and hydrates PostCSS classes                                                                                                                                                                                                                               |
| Stringify  | `stringify.ts` override calls jsbridge `stringify` with AST DTOs; builder callbacks receive Go-generated chunks and node metadata                                                                                                                                                                     |
| No-work    | `no-work-result.ts` calls jsbridge `noWork`; map generation and annotation normalization are Go-owned and do not use `map-generator.js`                                                                                                                                                               |
| Process    | jsbridge `process` RPC available; async/lazy plugin model not ported                                                                                                                                                                                                                                  |

## Validation

- Go engine: `go test ./...`
- Build overrides: `pnpm --filter postcss-go-compat build`
- Full upstream compatibility suite with this override applied: `pnpm test:upstream:go`
