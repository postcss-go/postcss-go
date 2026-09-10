# Native handle migration checkpoint

Current Phase 2 implementation and validation are described in the
[protocol 2.2 contract](native-handle-protocol-v2.md) and
[migration status](specs/go-owned-ast-handle-migration.md). Forced `handle` now
uses the read-only facade; retained Result.root no longer hydrates a second AST.
The earlier scalar-only behavior and measurements below are historical.

## Phase 2 verification (2026-09-10)

The general read-only facade, capability-based planner and batch snapshots are
implemented. Source/raws wrapping is lazy and uses a shared session cache.
Tests cover exact enumeration order, Document dispatch, original source identity,
parse/plugin errors, nested reflection writes, retained-wrapper GC and Workers.
Current verification totals are recorded in the migration specification after
final checks. `auto` remains binary. Mutation, async and source maps still require
later phases; the frozen mutation corpus is intentionally 0/7 in forced read-only
mode. See the protocol contract for the updated read-only benchmark scope.

## Historical September 7 checkpoint

Updated: 2026-09-07. This is the **session/protocol foundation**, not completion of
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
- The direct stringifier now initializes its render cache, fixing the nil-cache
  panic left in the WIP commit. Sibling positions are cached per render, with
  regression coverage across direct, general, builder and source-map rendering,
  plus mutation between renders. An unterminated final at-rule no longer inherits
  the preceding sibling's semicolon style.
- Successful scalar runs retain their Go session until lazy `Result.root`
  materialization or owner GC. Materialization parses the original input and
  projects final Go scalar fields onto it, preserving original source positions
  and shared Input identity without reinterpreting plugin-written CSS tokens.

## Rollout protection

`POSTCSS_GO_NATIVE_AST=auto` (default) and `binary` select the complete existing
AST runtime **before callbacks execute**. Callback shape alone cannot establish
that a JavaScript plugin uses only `prop` and `value`.

`POSTCSS_GO_NATIVE_AST=handle` explicitly selects the experimental synchronous,
declaration-only scalar path. Unsupported shapes/maps fail before callbacks;
unsupported property/helper access or thenables fail without replaying already
invoked callbacks. This restricted mode is for experiments, not a claim of full
PostCSS compatibility. It still lacks dirty revisits, general Go-backed facade
identity and structural visitors. Lazy `Result.root` still materializes a TS AST;
it is not yet the final Go-backed facade. Use `auto`/`binary` for full semantics.

## Verification

- Repository JS coverage: Core 96.74% lines, 89.90% branches, 99.37% functions;
  Webpack/Rspack 99.62% lines; Vite 100% lines. Existing thresholds unchanged.
- Go coverage: 95.7% statements; required threshold remains 90%.
- Core: 576 tests; upstream and Go-backed upstream suites: 701 tests each.
- Focused native/protocol/package/lifecycle suite: 35 tests, including parallel
  Workers, finalizer reclamation, nested sessions, >1 MiB UTF-8 values, >200000
  declarations, exact cursor-page boundaries, stale IDs, cyclic links, partial
  batch failures and detached ID buffers during JavaScript getters.
- Format, lint, TypeScript checks, all package builds and
  `go test -race ./internal/asthandle ./internal/nativebridge ./internal/stringifier`
  passed locally.
- `pnpm check:all` passed end-to-end on September 7, including remote upstream
  snapshot verification. The earlier transient download failure was resolved;
  no synchronization checks or coverage thresholds were disabled.

`pnpm bench:handles` builds on the already-built **production** package, not the
old boundary prototype. It compares five isolated-process samples per mode,
alternates order, verifies identical output, and enforces median time <=1.05x
and peak-process-RSS <=1.10x binary. The fixture is deliberately limited to
scalar declaration edits at 1000/10000 declarations, without root access or
maps. Passing it does not establish the full maintained-plugin-corpus gate.

September 7 production samples: Apple M1 Max, macOS 26.6.2, Node 24.20.0,
Go 1.26.3 darwin/arm64; 10 warmups and 30 timed iterations in each of five
isolated processes per mode. Median results:

| Declarations | Binary ms | Handle ms | Time ratio | Peak RSS ratio |
| ------------ | --------- | --------- | ---------- | -------------- |
| 1000         | 10.78     | 1.32      | 0.123      | 0.402          |
| 10000        | 1246.96   | 12.53     | 0.010      | 0.056          |

Both pass the script's median <=1.05x time and <=1.10x RSS checks. The large
binary samples ranged from 720 to 1736 ms and used roughly 6–7 GiB peak RSS;
they are **not stable enough for a throughput promise**. The live TS serializer
still repeats original CSS/map metadata on each node, while the Go decoder
constructs inputs for repeated CSS. Investigating that bulk-path allocation
cost, with mixed-input/map compatibility tests, remains a separate optimization.
Do not use this pathological binary baseline as evidence for default rollout.

## Requirement audit (2026-09-07)

The current implementation does **not** satisfy the migration definition of done.
The following distinguishes implemented foundations from phase exit criteria:

| Phase | Assessment                                                                           | Outstanding acceptance work                                                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Qualification inputs recorded in Phase 0 evidence                                    | Versioned corpus, base CI, benchmark and line-count artifacts recorded; selection and rollout gates remain blocked.                                                                                         |
| 1     | Protocol 2.1 contract, structured errors, source options and bounded IDs implemented | Protocol enums and capability bits are generated; patch/event execution and general facade capabilities remain gated for later phases.                                                                      |
| 2     | Not complete                                                                         | Runtime supplies restricted declaration stubs, not identity-cached standard node facades, Once, all visitors or source reads.                                                                               |
| 3     | Partial                                                                              | Go scalar field batches exist; JS supports only prop/value. Important, general scalar visitors, callback-level ordered multi-field patches, throw-time mutation retention and dirty revisits remain absent. |
| 4     | Not complete                                                                         | Relationships, tracked raws, source facades and handle source maps remain unavailable.                                                                                                                      |
| 5     | Not complete                                                                         | Snapshot cursors are not mutation-aware traversal; general structural plugin methods remain unavailable.                                                                                                    |
| 6     | Partial foundation                                                                   | Native owner GC exists, but async visitors are rejected and Result.root materializes a hydrated AST.                                                                                                        |
| 7     | Not complete                                                                         | Auto still selects binary; 95% corpus selection and native hydrated-store removal have not been achieved.                                                                                                   |
| 8     | Deferred, optional                                                                   | Browser serialization remains intentional.                                                                                                                                                                  |

Audit fixes: malformed or throwing protocol handshakes now reject handle
selection safely; minor versions and batch limits are validated. Required
capability masks are generated from the schema instead of hardcoded in the
TypeScript handshake. Cursor pages and declaration batches honor the negotiated
maximum. Oversized field batches fail before entering the addon; writes are not
split into independently committed chunks, preserving batch atomicity.

Regression coverage includes malformed/version-skewed handshakes, newer
compatible minors, small negotiated limits, cursor accumulation across uneven
pages, and rejection before any oversized batch write. These fixes harden the
restricted path; they do not complete the missing facade or authorize default
handle rollout.

Post-fix verification: `pnpm check:all` passed, including 578 core tests and
701 tests in each upstream mode. The focused handle/lifecycle suite passed
26 tests; `go test -race ./internal/asthandle ./internal/nativebridge`,
`go test ./...` and the generated-protocol drift check also passed. Performance
and memory benchmarks were not rerun for this audit.

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

## Maintained baseline

The versioned [native corpus](../packages/postcss-go/test/fixtures/native-corpus.json)
contains seven cases. Only one currently succeeds in forced handle mode; automatic
selection and no-hydration rollout gates remain blocked. The manifest preserves
an exact bulk source-map difference. CI generates and uploads benchmark, corpus
and runtime line-count artifacts; historical qualification reports are not kept
in the documentation tree. The bulk source-metadata allocation limitation recorded
above remains unresolved.

## Phase 1 protocol completion

The [protocol 2.1 contract](native-handle-protocol-v2.md) supersedes the earlier
protocol limitations in this historical checkpoint. Operations, node/patch/event
kinds, statuses and named capabilities are generated. Production C calls use
V2_1 symbols with call-owned errors; V2.0 signatures remain compatible adapters.
Parse options preserve original source identity, and session/node/cursor IDs
fail recoverably at uint32 exhaustion without reuse. These changes do not
implement the general PostCSS facade or change automatic runtime selection.
