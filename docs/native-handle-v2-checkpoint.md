# Native handle migration checkpoint

Date: 2026-09-06. This is the **session/protocol foundation**, not completion of
the [full Go-owned AST migration](specs/go-owned-ast-handle-migration.md).

## Implemented

- The production Node addon uses explicitly versioned `*V2` handle methods and
  C exports. Every operation carries a session ID. Old JS bundles cannot mistake
  the new signatures for the unversioned prototype; the bulk binary API remains
  available. Unversioned private handle exports are no longer published.
- Go owns the session registry, per-session operation locks, node tombstones,
  cursor state, batch validation, and canonical AST. Closing one session cannot
  close another. Closing is idempotent and safe against concurrent leases.
- Node IDs are never recycled. Session IDs also deliberately fail closed at
  uint32 exhaustion rather than wrap: a delayed native finalizer must not close
  a newer session with a recycled ID. Restart is necessary after exhaustion.
- A native finalizer follows the returned owner object. The TS session keeps
  that owner reachable; explicit close releases promptly. GC regression tests
  verify both reclamation and retained-owner survival.
- `protocol.json` generates Go scalar-field constants, TypeScript constants,
  and the C protocol header. `pnpm check:handles` checks drift without rewriting
  files; CI runs it and the Go race tests. This schema is not yet the full
  structural-patch/event protocol from the design.
- Field and CSS buffers grow to the required byte length, with explicit ABI
  size limits instead of fixed-buffer truncation. Buffers are call-local, not
  process-global. Cursor output no longer allocates an intermediate Go slice.
- Scalar batches validate every target before committing; duplicate targets
  are ordered (last write wins). Cyclic structural links are rejected before
  mutation. Disposing a container invalidates its attached subtree.
- Restricted declaration callbacks run in node-major order, consume 4096-node
  batches, and skip unchanged field writes. The cursor remains a **snapshot**;
  it is not a mutation-aware PostCSS traversal cursor.

## Rollout protection

`POSTCSS_GO_NATIVE_AST=auto` (default) and `binary` select the complete existing
AST runtime **before callbacks execute**. Callback shape alone cannot establish
that a JavaScript plugin uses only `prop` and `value`.

`POSTCSS_GO_NATIVE_AST=handle` explicitly selects the experimental synchronous,
declaration-only scalar path. Unsupported shapes/maps fail before callbacks;
unsupported property/helper access or thenables fail without replaying already
invoked callbacks. This restricted mode is for experiments, not a claim of full
PostCSS compatibility. It still lacks dirty revisits, general facade identity,
structural visitors and faithful original-node source metadata on lazy
`Result.root` hydration. Use `auto`/`binary` for those requirements.

## Verification

- Repository JS coverage: Core 96.47% lines, 89.86% branches, 99.16% functions;
  Webpack/Rspack 99.62% lines; Vite 100% lines. Existing thresholds unchanged.
- Go coverage: 95.6% statements; required threshold remains 90%.
- Core: 575 tests; upstream and Go-backed upstream suites: 701 tests each.
- Focused native/protocol/package/lifecycle suite: 35 tests, including parallel
  Workers, finalizer reclamation, nested sessions, >1 MiB UTF-8 values, >200000
  declarations, exact cursor-page boundaries, stale IDs, cyclic links, partial
  batch failures and detached ID buffers during JavaScript getters.
- Format, lint, TypeScript checks, all package builds and
  `go test -race ./internal/asthandle ./internal/nativebridge` passed locally.
- `pnpm check:all` is **not green as an aggregate**: its remote
  `check:upstream` download failed with `fetch failed`. Local vendored compatibility
  suites passed; remote snapshot freshness still needs verification with working
  network access. Subsequent checks were run independently.

`pnpm bench:handles` builds on the already-built **production** package, not the
old boundary prototype. It compares five isolated-process samples per mode,
alternates order, verifies identical output, and enforces median time <=1.05x
and peak-process-RSS <=1.10x binary. The fixture is deliberately limited to
scalar declaration edits at 1000/10000 declarations, without root access or
maps. Passing it does not establish the full maintained-plugin-corpus gate.

## Remaining migration work

The next implementation unit is the read-only Go-backed facade and original
source/Input identity, followed by ordered multi-property patches, tracked raws,
mutation-aware traversal, structural methods, maps and asynchronous callbacks.
Only after the maintained real-plugin corpus reaches the design's compatibility
and performance gates should `auto` prefer handles or native hydrated-AST code
be removed. Browser Worker serialization remains intentionally unchanged.

`node scripts/count-runtime-lines.mjs --baseline` and the same command without
the flag compare physical production source lines against HEAD, excluding tests,
generated outputs and the protocol generator. This foundation adds code; it does
**not** yet deliver the planned large TypeScript reduction. Do not use added Go
tests or generated constants to claim a language-ratio migration win.
