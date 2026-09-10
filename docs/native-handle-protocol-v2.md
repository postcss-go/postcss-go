# Native handle protocol 2.2

Phase 1 established the session/ABI contract. Phase 2 adds the synchronous
read-only facade: standard node prototypes, per-session wrapper identity, all
read-only visitors, filters, prepare/helpers, source reads and retained results.
`auto` and `binary` retain the hydrated runtime. Forced `handle` now selects the
read-only facade; it does not infer a scalar-write contract from callback shape.
The isolated scalar prototype remains covered by direct regression tests.

## Schema and negotiation

`internal/asthandle/protocol.json` is the source of explicit numeric IDs for
fields, operations, node kinds, patch kinds, event kinds and error statuses in
Go, C and TS. IDs must not be reassigned when entries are reordered. The generator
rejects duplicate IDs/names, invalid identifiers, unknown JSON properties,
trailing JSON, duplicate/out-of-range capability bits and required unimplemented
capabilities. `pnpm check:handles` verifies all generated outputs.

The base required mask remains 15 (ScalarSessions, StructuredErrors,
ParseOptions and BoundedIds). Protocol 2.2 advertises mask 31, adding the optional
ReadOnlyFacade capability. The read-only execution plan requires all 31 bits and
`handleReadSnapshotsV2`; old compatible scalar bridges can still negotiate the
base contract. AtomicPatches, MutationTraversal, SourceMaps and AsyncLifetime
remain unadvertised. Patch/event constants reserve wire vocabulary only.

TS accepts the matching major and any uint32 minor with every required bit,
including newer minor versions and unknown optional bits. Missing bits, throwing
method getters/handshakes and invalid limits fail negotiation before callbacks.
The absence of a compatible handle bridge leaves the binary path available.

## C ABI and errors

Fallible production C exports are named `pcgoHandle*V2_1`. JS methods retain their
`handle*V2` names. Changing C argument lists under the old symbol names would be
unsafe when a Windows addon and companion DLL come from different builds. Windows
loads the explicit new symbols, and its function pointer signatures match the
new generated cgo header.

Each fallible call receives a caller-initialized `pcgoHandleError` containing a
numeric status, dynamically allocated UTF-8 message and byte length. Status zero
means success. The C addon creates an Error with `status` and `message`; messages
are not stored in a global last-error buffer and are not fixed-size/truncated.
The addon calls `pcgoHandleFreeErrorV2_1` after copying the message so allocation
and freeing use the same Go-library C runtime, including on Windows. Transport
allocation failure reports Internal when no Go detail exists.

Statuses distinguish invalid/stale nodes, closed or nonexistent sessions,
non-containers, invalid fields/cursors, parse errors, cycles, ID exhaustion,
invalid arguments and unknown internal failures. Unsupported JS argument types
are rejected by N-API before Go entry. ID conversion rejects fractions, negatives,
NaN, infinity and values exceeding uint32 instead of N-API's default truncation.

`handles_legacy.go` preserves the original V2.0 C signatures and sentinel returns
as adapters. Legacy signed cursor callers fail closed above INT32_MAX. The current
addon never uses those fallible legacy exports. Keep them through the two-release
rollback window; remove them only with the corresponding native rollback cleanup.
Unversioned V1 exports exist only in isolated boundary benchmark prototypes,
which are not production imports or qualification evidence. Retire those prototypes
with Phase 7 cleanup; there is no production V1 bridge to retain.

## Source and identity

`NativeHandleSession.parse(css, { from, document, trackSource })` sends options as
JSON to session creation. The private addon accepts that optional JSON string.
Unknown options, malformed JSON, null and trailing values fail before a session
is allocated. There is no implicit `handle.css`. The original CSS, file/document
identity and shared Go Input are retained across nodes within the session.
Source-map processing and arbitrary custom parser options remain outside this
restricted interface and must use binary mode.

Session, node and cursor IDs are monotonic uint32 values with zero reserved.
They never wrap or reuse an ID. Exhaustion returns Exhausted without panic or
partial registration. Clone allocation preflights all required node IDs before
registering any; existing nodes remain usable after allocation failure. Sparse
node/cursor registries allow exact UINT32_MAX tests without allocating billions
of entries. Closed cursor payloads are released immediately; closing an already
closed cursor is idempotent and cannot affect a newer cursor.

Node identity is the pair `(sessionId, nodeId)`, never a node number alone.
Raw ABI callers must pass the owning session. Distinct sessions may contain equal
node numbers; read-only wrappers never accept mutation arguments. Future mutable methods must
reject wrapper arguments with another owner before passing IDs across the ABI.

Remove detaches a live node and preserves its ID for reinsertion/retained
references. Dispose permanently tombstones the attached subtree. A detached child
is not part of a former parent's disposed subtree. Close invalidates the session;
a delayed finalizer cannot close a newer session because session IDs never repeat.

## Read-only snapshots and execution

`pcgoHandleReadSnapshotsV2_1` / `handleReadSnapshotsV2` read a bounded list of IDs
into flat JSON rows containing scalar fields, parent/child IDs, formatting and
source positions. The C buffer grows to the reported size; negative lengths,
null pointers with positive lengths, oversized batches and stale IDs fail closed.
Rows do not repeat source CSS or construct a recursive AST DTO. Source positions
reuse the same Go conversion as the binary bridge, including rule semicolons.
The additive export uses the existing V2_1 error ABI; no old signature changes.
Windows resolves this optional symbol without disabling an older companion's
binary/scalar bridge, and clears ReadOnlyFacade when the symbol is absent.

`SessionOwner` reads pages once and lazily creates wrappers with the standard
Root, Document, Rule, AtRule, Declaration and Comment prototypes. Each handle
has one wrapper, including parent/nodes/visitor/reflection access. Every wrapper
retains the session owner. Source/raws wrappers are allocated only on first read,
using one protection cache per session instead of per-node caches. Raws, source metadata and child arrays reject writes,
including writes through property descriptors; source Input is shared. Existing
read methods are reused. Stringification reads Go state directly. Successful
Result.root access never parses or hydrates a second AST. BOM handling matches
the binary plugin runtime.

The execution plan contains the selected runtime, required capabilities and a
diagnostic reason. Auto deliberately chooses binary because arbitrary JavaScript
access cannot be proven from callback shape. Known async callbacks and maps are
rejected before handle callbacks. Unexpected thenables, writes and Result.root
replacement fail without replay; errors close the session. For invalid CSS only,
the processor reuses binary parse diagnostics before any callback, since the base
handle ABI exposes status/message rather than full syntax-error metadata.

Forced handle runs now reject scalar writes as well as structural writes. The
seven-case maintained corpus keeps its CSS/options/version pins and denominator;
its Phase 2 expected handle selection is 0/7, since every case mutates, uses async
or maps. This is an explicit change from the scalar prototype's 1/7 and is not a
rollout improvement. General scalar transactions and revisits remain Phase 3.
Read-only differential fixtures and page-call assertions are in
`packages/postcss-go/test/handle-facade.test.ts`, separate from rollout scoring.

## Phase 2 verification (2026-09-10)

- Forced-mode tests compare CSS, visitor order, scalar/source reads, standard
  prototypes, enumeration order, JSON, warnings, messages and errors.
- 5000 declarations require two snapshot pages; repeated property reads add no
  boundary calls. Retained wrappers survive GC and release their arenas when
  unreachable. Parallel Workers preserve per-session identities.
- The updated `benchmark/run-handles.mjs --qualification` measures the production
  read-only facade and checks visitor counts/checksums across modes. Local M1 Max
  samples (Node 24.21.0, Go 1.26.3; five processes, 10 warmups, 30 iterations)
  passed time/RSS/stability checks for 1000 declarations and Modern Normalize.
  Time ratios were 0.64/0.80 and peak RSS ratios 0.84/0.84. These working-tree
  measurements do not establish the full mutation corpus or rollout gate.

## Protocol verification

Regression tests exercise schema rejection/generation, every required capability,
newer-minor negotiation, throwing getters, malformed owner IDs, source propagation,
call-local native errors, invalid numeric IDs, detach/reinsert/dispose and exact
uint32 exhaustion of sessions, nodes and cursors. Failed clone allocation is atomic.
The existing large fields/cursors, interleaved sessions, Workers and finalizer
tests remain applicable. CI generates benchmark and phase-boundary line-count
artifacts using `benchmark/run-handles.mjs` and `scripts/count-runtime-lines.mjs`.
The maintained corpus lives in `packages/postcss-go/test/fixtures/native-corpus.json`.

Native execution is validated locally on macOS arm64. Windows dynamic function
pointer declarations are checked against the actual cgo header with the C compiler;
Windows runtime execution and other platform binaries remain CI responsibilities.
