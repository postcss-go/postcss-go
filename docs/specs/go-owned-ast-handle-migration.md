# Go-Owned AST and Native Handle Migration

- Status: Proposed
- Target: `@postcss-go/core` native backend
- Last updated: 2026-09-04
- Owners: TBD

## Summary

Move native PostCSS execution toward a Go-owned AST session while retaining JavaScript/TypeScript for the public PostCSS API, JavaScript plugin callbacks, configuration loading, and environment adapters.

The native path will expose session-scoped node handles to a thin TypeScript facade. Go will own parsing, node storage, traversal state, mutation, stringification, and source-map inputs. TypeScript will normalize plugins, invoke JavaScript callbacks, and project Go-backed nodes into PostCSS-compatible JavaScript objects.

The browser Worker path will continue using a serializable AST during the initial migration. A later, separately gated experiment may move the browser-side mutable AST into a main-thread Go/WASM handle runtime. Repository language percentages are not a reason to weaken browser isolation or compatibility.

## Motivation

The current repository already uses Go for parsing, canonical AST storage, stringification, source-map primitives, and native/WASM execution. However, the TypeScript runtime still hydrates and manages a second AST representation for general plugin execution. This duplicates behavior across languages and makes native processing pay for encoding, decoding, allocation, and synchronization that the Go AST has already performed.

As of this specification:

| Metric                                                |     Baseline |
| ----------------------------------------------------- | -----------: |
| Production TypeScript under `packages/**/src`         | 10,077 lines |
| Production TypeScript under `packages/postcss-go/src` |  8,006 lines |
| Production Go under `cmd`, `internal`, and `pkg`      |  9,745 lines |

These values are planning baselines, not success metrics by themselves. Test code is deliberately excluded and must not be rewritten merely to change a language ratio.

The existing handle prototype proves that declaration-only synchronous plugins can avoid full AST hydration. It is not yet a general runtime because it uses one process-global native session, exposes only a small set of fields, and falls back after encountering unsupported JavaScript behavior.

## Goals

1. Make Go the source of truth for the mutable AST in the Node native backend.
2. Preserve observable PostCSS behavior for supported plugins, including node identity, traversal order, mutation semantics, warnings, messages, errors, and source maps.
3. Replace the process-global handle prototype with a versioned, multi-session, concurrency-safe protocol.
4. Reduce native-path TypeScript to adapters, JavaScript object projection, plugin invocation, and capability selection.
5. Expand the handle path incrementally, with measurable gates and a reliable bulk-AST fallback.
6. Remove native-only codec and hydrated-AST work after the handle path reaches compatibility and performance gates.
7. Keep the WASM Worker path functional and explicitly account for its serialization constraint.

## Non-goals

- Reimplement JavaScript plugin callbacks, Promise scheduling, JavaScript configuration loading, or module resolution in Go.
- Rewrite bundler adapters or browser lifecycle code in Go.
- Rewrite TypeScript tests in Go solely to increase the Go percentage.
- Change the public `postcss`-compatible API or require plugin authors to use a new API.
- Make Go call JavaScript directly. TypeScript remains the callback coordinator.
- Remove the bulk binary path before the handle path has passed compatibility, performance, and rollback gates.
- Move the browser Worker AST to Go/WASM in the first rollout.

## Compatibility invariants

The migration must preserve the following invariants:

- The same JavaScript object is returned for the same live node within a processing result.
- `instanceof`, prototypes, enumerable properties, getters/setters, and documented node methods behave like the current facade.
- Reads after writes within the same callback observe the new value.
- Structural mutations performed while walking affect subsequent traversal according to PostCSS semantics.
- `Root`, `Document`, `Rule`, `AtRule`, `Declaration`, and `Comment` remain distinguishable.
- `parent`, `nodes`, sibling navigation, cloning, removal, insertion, replacement, and dirty-state behavior remain compatible.
- `raws`, `source`, `positionInside`, `positionBy`, errors, warnings, and messages remain compatible.
- Async callbacks may retain node references across `await` while their result/session is alive.
- A result's root remains usable after `Processor.process()` resolves.
- Native addon/package version skew fails capability negotiation safely and never corrupts memory.
- The WASM backend continues to work when the native addon is unavailable.

## Target architecture

```text
JS API / config / loaders / JavaScript plugins
                        |
          TypeScript callback coordinator
          + PostCSS-compatible node facade
                        |
       versioned capabilities + batched handles
                        |
        Go session / AST / traversal / mutation
             / stringify / map inputs
```

Native and browser execution deliberately diverge at the AST transport boundary:

| Concern                              | Node native                           | Browser Worker during this migration    |
| ------------------------------------ | ------------------------------------- | --------------------------------------- |
| Canonical mutable AST during plugins | Go session                            | Hydrated serializable AST in TypeScript |
| Plugin callbacks                     | Main-thread JavaScript                | Main-thread JavaScript                  |
| Transport                            | Handles, event batches, patch batches | Structured-clone-compatible DTO         |
| Parsing/stringification              | Go native                             | Go WASM Worker                          |
| Fallback                             | Existing bulk binary AST              | Existing browser path                   |

## Detailed design

### 1. Versioned handle protocol

Replace method-existence probing with an explicit handshake:

```ts
type HandleProtocolInfo = {
  major: number;
  minor: number;
  capabilities: Uint32Array;
  maxBatchSize: number;
};
```

The TypeScript package must reject an incompatible major version. A newer minor version is accepted only when all capabilities required for a selected execution plan are present.

Protocol operations, node kinds, field identifiers, patch kinds, event kinds, status codes, and capability bits must be generated from one checked-in schema:

```text
internal/asthandle/protocol.json
internal/asthandle/protocol_gen.go
packages/postcss-go/src/generated/handle-protocol.ts
packages/postcss-go/native/handle_protocol.h
```

Generation will be implemented in Go under `internal/asthandle/cmd/genprotocol`. Generated files are checked in. CI must run generation and fail on a diff.

Minimum initial capabilities:

- `session.multiple`
- `node.read.scalar`
- `node.write.scalar`
- `walk.declaration`
- `batch.read`
- `batch.patch`
- `stringify.root`

Capabilities are additive within a protocol major version.

### 2. Session and handle identity

Every operation must receive a `SessionID`. Creating a new session must not close or replace another session.

```ts
type SessionID = number; // unsigned 32-bit
type NodeID = number; // unsigned 32-bit, scoped to SessionID
type CursorID = number; // unsigned 32-bit, scoped to SessionID
```

V2 node IDs must not be reused during a session. Removing or disposing a node tombstones the ID; the slot is reclaimed only when the session closes. This avoids stale-handle ABA bugs without packing a small generation counter into the JavaScript number.

Go maintains:

- A process-level registry protected by a registry lock.
- One lock and one error state per session.
- Monotonic session IDs that skip IDs still present after wraparound.
- Monotonic node and cursor IDs within a session.
- Explicit closed/tombstoned errors with stable numeric status codes.

The process-global `handleSession` and `handleErr` in `internal/nativeaddon/cabi/handles.go` must be removed before V2 is enabled outside tests.

The Node-API surface should expose JavaScript-friendly methods such as:

```ts
handleProtocolInfo(): HandleProtocolInfo;
handleSessionCreate(css: string, options: ParseOptions): {
  sessionId: SessionID;
  rootId: NodeID;
};
handleSessionClose(sessionId: SessionID): void;
handleReadBatch(sessionId: SessionID, request: Uint32Array): HandleReadBatch;
handleApplyPatches(sessionId: SessionID, patches: HandlePatchBatch): void;
handleCursorOpen(sessionId: SessionID, rootId: NodeID, mode: number): CursorID;
handleCursorNext(sessionId: SessionID, cursorId: CursorID, out: Uint32Array): number;
handleCursorClose(sessionId: SessionID, cursorId: CursorID): void;
handleStringify(sessionId: SessionID, nodeId: NodeID, options: StringifyOptions): string;
```

The C ABI may use out-parameters, but it must preserve the same session-scoped semantics. No caller should depend on a process-global last-error buffer.

### 3. Session lifetime

A native result and all of its node wrappers share one internal `SessionOwner` JavaScript object. The native session remains open while that owner is reachable.

- `Processor.process()` must not close a successful session in `finally`.
- The Node-API external/finalizer closes the session when `SessionOwner` becomes unreachable.
- Explicit internal close is allowed after the result has been fully materialized into the fallback representation.
- Closing is idempotent.
- Node wrappers hold the owner, not just numeric IDs.
- Async callback state holds the owner across `await`.

No new public `dispose()` API is required for the first release. A diagnostic session counter is required in non-production/test builds so leak tests can assert that sessions are released after garbage collection.

### 4. JavaScript node facade

The TypeScript facade maps `(SessionOwner, NodeID)` to exactly one wrapper object using a per-session identity cache. The wrapper's prototype is selected from the existing PostCSS-compatible node classes.

The facade must support two access classes:

1. **Snapshot fields**: common scalar values fetched in a batch before a callback, cached locally, and flushed as a patch batch afterward.
2. **Live operations**: structural or relationship operations that must be applied immediately because they can change subsequent traversal or reads.

Initial snapshot fields are:

- node kind and name/type
- declaration `prop`, `value`, and `important`
- rule `selector`
- at-rule `name` and `params`
- comment `text`

Later phases add source coordinates and raw formatting data. Nested `raws` objects must use tracked proxies or explicit setters; returning a detached copy is not compatible because code commonly performs nested mutation.

Patch application is transactional per callback:

- Scalar setters update the local snapshot immediately.
- At callback completion, changed fields are sent in one ordered patch batch.
- If the callback throws, PostCSS-visible mutations made before the throw must match the current runtime. The coordinator therefore flushes recorded mutations before propagating the error when current behavior does so.
- A failed patch batch must not be partially applied. Go validates every target, field, and value before committing the batch.

Structural methods apply synchronously to the session and invalidate affected cached relationships. Common scalar loops must not perform one Node-API call per property access.

### 5. Plugin capability planning

Before invoking the first callback, TypeScript builds an execution plan from:

- plugin shape (`Once`, visitors, `OnceExit`, prepare result)
- sync or async callbacks
- visitor node kinds and filters
- requested process options, especially maps
- protocol version and capabilities
- known unsupported public APIs or custom node types

The initial planner is conservative. An execution plan selects one of:

```ts
type ExecutionPlan =
  | { mode: 'native-handle'; requiredCapabilities: Uint32Array }
  | { mode: 'native-binary'; reason: string }
  | { mode: 'wasm-serialized'; reason: string };
```

The reason is available to diagnostics but does not change public processing output.

Fallback must occur before the first plugin callback whenever the planner cannot prove compatibility. Once a callback has begun, the runtime must never silently restart that callback on a hydrated AST because plugins may have external side effects.

During restricted rollout phases, unexpected unsupported property access produces a deterministic compatibility error in development/opt-in mode. It is not converted into a silent callback replay. The default automatic path must only select capabilities that have complete facade coverage.

### 6. Traversal ownership

Traversal moves to Go in two stages.

**Restricted traversal** may batch events when plugins cannot structurally mutate the tree. It covers read-only or scalar-only visitors and is the successor to the current declaration fast path.

**Mutation-aware traversal** uses a resumable Go cursor. It must preserve:

- enter/exit ordering
- visitor filtering
- insertion before/after the current node
- removal or replacement of the current node
- moving nodes between parents
- dirty marking and repeat-until-clean behavior
- `Once` and `OnceExit` ordering

An entire mutable walk must not be precomputed. Structural changes can invalidate future events. The cursor may return small batches only when the execution plan proves that the relevant structure cannot change; otherwise it yields one event at a time and batches field data for that event.

JavaScript remains responsible for invoking callbacks. Go never owns or calls a JavaScript function pointer.

### 7. Source maps and source objects

Source-map support is a release gate, not a cleanup task.

- Source offsets and file/input identifiers live in the Go session.
- JavaScript `Input` and source facade objects are cached by session-local identifiers.
- `node.source`, `positionInside`, `positionBy`, error construction, and warning locations must be differential-tested against the bulk path.
- Existing previous-map and annotation behavior remains available through the bulk path until handle behavior is equivalent.
- `options.map` must force `native-binary` until the required map capabilities are advertised.

### 8. Native and WASM code separation

The current shared TypeScript AST implementation must be separated by responsibility instead of deleted prematurely:

```text
packages/postcss-go/src/ast-contract.ts       shared public types and thin classes
packages/postcss-go/src/ast-native.ts         Go-handle-backed native facade
packages/postcss-go/src/ast-hydrated.ts       browser/bulk fallback store
packages/postcss-go/src/handle-runtime.ts     planning and callback coordination
```

Exact filenames may change during implementation, but the dependency direction may not: shared public types must not import the hydrated store.

After native handle rollout, native bundles must not include the hydrated store or binary AST decoder unless fallback has been selected. Browser bundles retain them.

The remaining hydrated TypeScript AST is reviewed only after native completion. A browser Go/WASM handle experiment may proceed if it preserves plugin compatibility and passes bundle-size, memory, startup, and responsiveness gates. Until then, browser isolation has priority over raw TypeScript line reduction.

## Work plan

Each phase should land as one or more independently revertible pull requests. A later phase may not make an earlier phase's fallback unusable.

### Phase 0 — Stabilize the baseline

Deliverables:

- Make `pnpm check:all` pass, including existing `ast.ts` type errors.
- Run the core typecheck as an explicit required CI step; do not rely on declaration bundling logs.
- Repair the current upstream-sync baseline and align compatibility fixtures with the vendored PostCSS version.
- Document any upstream-test allowlist with an owner and reason.
- Add a test/coverage threshold for the webpack loader or explicitly remove unsupported code.
- Capture current bulk-binary and declaration-handle benchmark results.

Exit criteria:

- Required CI is green on the migration base commit.
- Upstream compatibility results are reproducible locally and in CI.
- Benchmark artifacts identify runtime, CPU, operating system, fixture size, and iteration count.

### Phase 1 — Protocol schema and multi-session V2

Deliverables:

- Add the protocol schema and Go generator.
- Add handshake/version validation.
- Replace the global native session with the session registry.
- Implement non-reused session-scoped node IDs and cursor IDs.
- Add lifecycle, stale-ID, cross-session, concurrent-session, and close-idempotency tests.
- Keep the V1 bridge available only as an internal compatibility path.

Exit criteria:

- Two simultaneous processors cannot observe or close one another's AST.
- `go test -race` reports no handle/session races.
- Generated Go, TypeScript, and C constants cannot drift in CI.

### Phase 2 — Read-only visitors

Supported surface:

- `Once`
- read-only visitors for all standard node kinds
- scalar fields, parent/type identity, and basic source reads
- visitor filters that do not require structural mutation

Deliverables:

- Generalize the current declaration-only planner.
- Batch visitor event metadata and scalar reads.
- Add per-session node identity caching.
- Add differential tests that run the same plugin through handle and binary modes.

Exit criteria:

- All read-only differential fixtures produce identical CSS, messages, warnings, and thrown errors.
- Boundary calls are measured and are not proportional to scalar property reads.

### Phase 3 — Scalar mutation

Supported surface:

- declaration `prop`, `value`, `important`
- rule `selector`
- at-rule `name`, `params`
- comment `text`
- ordered patch batches

Deliverables:

- Transactional Go patch validation/application.
- Callback-local snapshots with read-after-write behavior.
- Dirty marking required by changed values.
- Tests for throws after mutation and multiple writes to the same field.

Exit criteria:

- The existing declaration handle benchmark uses V2.
- Scalar mutation output matches the binary path for the owned and upstream corpus selected for this phase.

### Phase 4 — Relationships, source, and `raws`

Supported surface:

- `parent`, `nodes`, `first`, `last`, `next`, `prev`
- source objects and position helpers
- raw formatting reads and nested mutation
- clone data required by non-structural callbacks

Deliverables:

- Live relationship access with cache invalidation.
- Stable source/input facade identity.
- Tracked `raws` updates.
- Source-map differential fixtures.

Exit criteria:

- `options.map` no longer forces fallback for the covered map modes.
- Identity, enumeration, source-position, and raw-format contract tests pass.

### Phase 5 — Structural mutation and Go traversal

Supported surface:

- append/prepend/insert before/insert after
- remove/removeAll/replaceWith
- clone/cloneBefore/cloneAfter
- moving nodes between containers
- enter/exit visitors and dirty-loop behavior

Deliverables:

- Mutation-aware resumable Go cursor.
- Immediate structural operations.
- Correct traversal invalidation and continuation.
- Mutation-heavy differential and fuzz tests.

Exit criteria:

- The covered upstream plugin corpus runs without AST hydration.
- Traversal-order traces are identical to the binary path.

### Phase 6 — Async callbacks and result lifetime

Deliverables:

- Preserve sessions and node wrappers across `await`.
- Add cancellation/error cleanup.
- Add native finalizer and leak diagnostics.
- Stress overlapping async `process()` calls.

Exit criteria:

- Retained node references remain valid until their result is unreachable.
- Cancellation, rejection, and garbage collection do not leak live sessions.
- Concurrent stress tests pass under the race detector and sanitizers available in CI.

### Phase 7 — Default rollout and native cleanup

Deliverables:

- Enable V2 handle mode by default for capability-complete workloads.
- Keep a documented environment override for emergency rollback during the rollout window.
- Remove V1 and native-path dependencies on hydrated AST/codec code after two compatible releases.
- Update architecture, benchmark, and contributor documentation.

Exit criteria:

- At least 95% of the maintained native compatibility corpus selects handle mode.
- No supported fixture silently replays a plugin callback during fallback.
- Performance, memory, compatibility, and leak gates below are green.

### Phase 8 — Optional browser Go/WASM AST experiment

This phase is not required for the native migration.

Prototype a main-thread Go/WASM AST session used only for synchronous node access while parsing/stringification remain in the Worker. Compare it with the hydrated TypeScript store.

Proceed only if all of these are true:

- No public plugin capability is lost.
- Browser startup and median processing time regress by no more than 5%.
- Peak memory and compressed bundle size regress by no more than 10%.
- Main-thread long tasks do not materially increase on the maintained large fixtures.

If the experiment fails a gate, keep the hydrated browser AST and treat it as an intentional adapter, not migration debt.

## Testing strategy

### Go unit and fuzz tests

- Session registry creation, lookup, close, and ID wrap behavior.
- Node tombstones and cross-session access.
- Atomic patch validation and rollback.
- Mutation-aware cursor invariants.
- Fuzz sequences of read, write, insert, move, clone, remove, and stringify.

### Native integration tests

- Protocol mismatch and missing capability behavior.
- Two or more interleaved sessions.
- Finalizer cleanup and explicit internal cleanup.
- Large strings and batches without fixed-size truncation.
- Repeated open/close and cursor abandonment.

### TypeScript contract tests

- Object identity and prototypes.
- Enumerability and JSON behavior where currently supported.
- Snapshot read-after-write and patch ordering.
- Relationship invalidation.
- Nested `raws` mutation.
- Async node retention.
- No callback replay on unsupported access or error.

### Differential compatibility tests

Every new capability requires fixtures that run in both `native-handle` and `native-binary` modes and compare:

- final CSS
- serialized AST where applicable
- source maps
- messages and warnings
- error type, message, source location, and plugin attribution
- callback/traversal trace

The maintained upstream compatibility suite remains the release-level behavioral gate. Failures require either a fix or a narrow, documented allowlist approved before merge.

### Required verification commands

Commands may be wrapped by package scripts, but CI must cover the equivalent of:

```sh
pnpm check:all
pnpm --filter @postcss-go/core test
pnpm test:upstream:go
pnpm bench:boundary
go test -race ./internal/asthandle ./internal/nativebridge
go test ./...
```

## Performance and observability gates

Record these metrics per processing run in benchmarks and optionally behind debug diagnostics in development builds:

- selected execution plan and fallback reason
- number of live sessions
- nodes visited and mutated
- boundary calls and bytes transferred
- read batches, patch batches, and average batch size
- whether any full AST encoding/hydration occurred
- parse, callback, patch, stringify, and source-map durations

Rollout gates:

- A workload is not switched to handle mode by default if its median wall time exceeds binary mode by more than 5% over at least five stable runs.
- Peak resident memory may not exceed binary mode by more than 10% on the maintained corpus.
- Common declaration visitors must batch field reads and writes; total boundary calls must not scale with the number of scalar property accesses.
- No fixed output buffer may truncate valid CSS, field values, batches, or errors.
- Native handle mode must avoid full AST encoding/hydration for capability-complete workloads.

## Rollout and rollback

During development, support an internal override:

```text
POSTCSS_GO_NATIVE_AST=auto|handle|binary
```

- `auto` is the shipping default and chooses only capability-complete plans.
- `handle` is an opt-in test mode and surfaces compatibility errors rather than replaying callbacks.
- `binary` is the emergency rollback path.

The override is diagnostic and is not a permanent public API. It may be removed only after two releases in which handle mode is the default, the compatibility suite remains green, and no high-severity session or data-corruption issue is open.

Rollback consists of changing `auto` selection back to `native-binary`; it must not require rebuilding the Go parser or changing plugin code. Schema/protocol additions remain backward compatible within the current major version even when the handle path is disabled.

## Success metrics

Primary metrics measure ownership and runtime behavior:

- At least 95% of maintained Node-native plugin fixtures execute without hydration.
- All production native AST mutations pass through Go session operations.
- Go owns traversal and dirty-loop state for handle-selected workloads.
- Upstream and owned compatibility suites pass at the agreed baseline.
- Handle-selected workloads meet the performance and memory gates.

Secondary code-size metrics:

- Native bundles exclude the hydrated AST store and binary decoder when fallback is not selected.
- Native-specific runtime TypeScript decreases phase by phase; no target is met by deleting tests or moving TypeScript unchanged into generated files.
- Remaining production TypeScript files have an explicit adapter, JavaScript-runtime, browser, or public-API responsibility.

The baseline line counts should be refreshed at the start and end of each phase using a checked-in script so file selection remains consistent.

## Risks and mitigations

| Risk                                                | Mitigation                                                      |
| --------------------------------------------------- | --------------------------------------------------------------- |
| JavaScript object identity differs from PostCSS     | Per-session wrapper cache and dedicated identity tests          |
| One property access becomes one native call         | Callback snapshots, event batches, and patch batches            |
| Structural mutation invalidates a prefetched walk   | Mutation-aware Go cursor; no full precomputation                |
| Async callback outlives the native session          | Shared `SessionOwner` and native finalizer                      |
| Unsupported access causes duplicated side effects   | Plan before callbacks; never silently replay a started callback |
| Session concurrency corrupts another process result | Session IDs, registry/per-session locks, race tests             |
| Nested `raws` mutation is lost                      | Tracked nested proxy and differential raw-format tests          |
| Source maps diverge                                 | Keep binary fallback until map capability tests pass            |
| Protocol constants drift                            | Single schema, Go generator, checked-in outputs, CI diff check  |
| Go/WASM increases browser cost                      | Defer to Phase 8 and enforce browser-specific gates             |

## Decisions and deferred questions

Decisions made by this specification:

- Use session-scoped non-reused 32-bit node IDs for V2.
- Keep JavaScript callbacks in TypeScript.
- Keep the bulk binary path as rollback until after two compatible releases.
- Keep the browser hydrated AST during the native migration.
- Judge progress by runtime ownership and compatibility before raw repository language percentage.

Questions to resolve before their respective phases:

1. Which exact `raws` substructures need tracked proxies versus explicit facade classes? Resolve in Phase 4 from upstream fixtures.
2. Which source-map modes can be enabled independently as capability bits? Resolve in Phase 4.
3. Which real-world plugin corpus supplements upstream tests for the 95% handle-selection gate? Select and pin it in Phase 0.
4. Whether a browser Go/WASM AST is worth its startup and memory cost. Resolve only from Phase 8 measurements.

## Definition of done

This migration is complete when:

- The native backend uses V2 Go AST sessions by default for the maintained supported surface.
- Plugin callbacks receive PostCSS-compatible Go-backed node objects without full AST hydration.
- Go owns native traversal, mutation, stringify inputs, and session lifecycle safely under concurrent and async use.
- Compatibility, differential, source-map, race, leak, performance, and memory gates pass in CI or release qualification.
- The binary fallback remains available for the documented rollout window and emits an actionable fallback reason in diagnostics.
- Native-only TypeScript AST/codec duplication has been removed, while intentional JavaScript-runtime and browser adapters remain documented.
