# Native handle protocol 2.1

Phase 1 completes the session/ABI contract. It does not implement the general
PostCSS node facade, transactional patches, mutable traversal, maps or async
plugins. `auto` and `binary` retain the hydrated runtime; forced `handle` retains
the restricted scalar visitor path and the Phase 0 corpus denominator.

## Schema and negotiation

`internal/asthandle/protocol.json` is the source of explicit numeric IDs for
fields, operations, node kinds, patch kinds, event kinds and error statuses in
Go, C and TS. IDs must not be reassigned when entries are reordered. The generator
rejects duplicate IDs/names, invalid identifiers, unknown JSON properties,
trailing JSON, duplicate/out-of-range capability bits and required unimplemented
capabilities. `pnpm check:handles` verifies all generated outputs.

The advertised and required mask is 15: ScalarSessions, StructuredErrors,
ParseOptions and BoundedIds. These describe the implemented private ABI, not
PostCSS facade compatibility. ReadOnlyFacade, AtomicPatches, MutationTraversal,
SourceMaps and AsyncLifetime are reserved and **not advertised**. Patch/event
constants reserve wire vocabulary only; there is no generic patch/event dispatch
implementation yet. Only implemented production bridge operations are catalogued.

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
node numbers; the future JS facade must reject wrapper arguments with another
owner before passing numeric IDs across the ABI.

Remove detaches a live node and preserves its ID for reinsertion/retained
references. Dispose permanently tombstones the attached subtree. A detached child
is not part of a former parent's disposed subtree. Close invalidates the session;
a delayed finalizer cannot close a newer session because session IDs never repeat.

## Verification

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
