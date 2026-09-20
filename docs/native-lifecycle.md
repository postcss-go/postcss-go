# Node native lifecycle contract

The `postcss-go` Node backend is a context-aware Node-API addon. Each
Node.js main thread or Worker Thread loads and owns its own JavaScript addon
instance. The Go runtime and compiled code may be shared by the process, but no
JavaScript values, AST nodes, callbacks, deferred values, or service state cross
an environment boundary.

## Work and ownership

- Promise-returning `process` / `noWork` copy their inputs before queuing
  `napi_async_work`. The worker callback only accesses native memory and Go; it
  never accesses a `napi_value`.
- The completion callback is the sole owner of Promise settlement and releases
  the copied inputs, output buffer, and async-work handle.
- Synchronous bulk operations borrow input buffers only for the duration of the
  call. Their result is copied into a JavaScript string before native memory is
  released.
- Live AST work uses unversioned handle methods (`handleParse`, …) on the Node
  thread. The tree stays in a Go arena; JavaScript holds session/node IDs plus
  wrapper objects. Closing a session is idempotent; node IDs are not reused.
- `NativePostcssGoService.close()` is intentionally a no-op. The service owns
  no thread or subprocess. Arena lifetime follows the wrapper graph:
  `FinalizationRegistry` retains `{bridge, sessionId}` and calls `handleClose`
  when the public tree is unreachable. Explicit `SessionOwner.close()` is
  allowed on error paths.

## Worker termination and process shutdown

Queued Node-API async work participates in the owning environment's event-loop
lifecycle. Normal shutdown waits for queued work and its completion callback.
When a Worker is terminated, Node cancels environment-owned work; the completion
path treats a non-`napi_ok` status as cancellation and releases the task exactly
once.

Handle sessions are process-level Go registry state. They are not tied to a
single async-work task. Unreachable wrappers close their sessions through the
finalizer; a terminated Worker must not leave JavaScript wrappers that still
point at that environment's addon.

Applications must not transfer Go-backed node wrappers between Workers.
Transfer CSS text or an application-owned serialization and parse it in the
receiving Worker.

## Error and panic translation

Expected Go errors cross the private C ABI as UTF-8 messages. Handle calls use
a call-scoped status/message envelope rather than a process-global last-error
buffer. Synchronous calls throw a JavaScript `Error`; asynchronous calls reject
their Promise with a JavaScript `Error`. The exported Go entry point recovers
panics and translates them to the stable prefix `postcss-go native panic:`. A
panic therefore never unwinds through C or Node-API.

Cancellation uses `postcss-go native async work was cancelled`. Allocation and
Node-API setup failures use stable `postcss-go native` messages. CSS parser
errors are rehydrated by the public TypeScript layer as `CssSyntaxError` with
source location and input metadata.

## Release validation

The native build workflow produces one package for each declared tuple:
macOS arm64/x64, Linux glibc arm64/x64, and Windows MSVC arm64/x64. On every
runner it packs the platform package and
`@postcss-go/core`, installs both tarballs into a clean project, exercises
synchronous and asynchronous parse, stringify, process, and noWork (live parse
returns a Go-owned tree), and repeats native work inside a Worker Thread.
Platforms that cannot link the Go archive directly include a validated
shared-library companion beside the addon. Publication consumes only those
validated artifact sets.

Linux musl is not declared as a native target. Stock Go currently emits an
initial-exec TLS runtime for c-archive and c-shared builds, which musl cannot
load through Node's `dlopen` path. The upstream blocker is
`golang/go#54805`; the loader reports the backend as unavailable instead of
publishing packages that cannot load.
