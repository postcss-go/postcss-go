# Node native lifecycle contract

The `@postcss-go/core` Node backend is a context-aware Node-API addon. Each
Node.js main thread or Worker Thread loads and owns its own JavaScript addon
instance. The Go runtime and compiled code may be shared by the process, but no
JavaScript values, AST nodes, callbacks, deferred values, or service state cross
an environment boundary.

## Work and ownership

- Promise-returning operations copy their inputs before queuing
  `napi_async_work`. The worker callback only accesses native memory and Go; it
  never accesses a `napi_value`.
- The completion callback is the sole owner of Promise settlement and releases
  the copied inputs, output buffer, and async-work handle.
- Synchronous operations borrow input buffers only for the duration of the
  call. Their result is copied into a JavaScript string or Buffer before native
  memory is released.
- `NativePostcssGoService.close()` is intentionally a no-op. A service owns no
  thread, subprocess, persistent AST handle, or external native allocation.

## Worker termination and process shutdown

Queued Node-API async work participates in the owning environment's event-loop
lifecycle. Normal shutdown waits for queued work and its completion callback.
When a Worker is terminated, Node cancels environment-owned work; the completion
path treats a non-`napi_ok` status as cancellation and releases the task exactly
once. No global cleanup callback is required because the addon has no
environment-scoped native state after each task completes.

Applications must not transfer hydrated AST class instances between Workers.
Transfer CSS text or an application-owned serialization and parse it in the
receiving Worker.

## Error and panic translation

Expected Go errors cross the private C ABI as UTF-8 messages. Synchronous calls
throw a JavaScript `Error`; asynchronous calls reject their Promise with a
JavaScript `Error`. The exported Go entry point recovers panics and translates
them to the stable prefix `postcss-go native panic:`. A panic therefore never
unwinds through C or Node-API.

Cancellation uses `postcss-go native async work was cancelled`. Allocation and
Node-API setup failures use stable `postcss-go native` messages. CSS parser
errors are rehydrated by the public TypeScript layer as `CssSyntaxError` with
source location and input metadata.

## Release validation

The native build workflow produces one package for each declared tuple:
macOS arm64/x64, Linux glibc arm64/x64, Linux musl arm64/x64, and Windows MSVC
arm64/x64. On every runner it packs the platform package and
`@postcss-go/core`, installs both tarballs into a clean project, exercises all
four synchronous and asynchronous operations, and repeats native work inside a
Worker Thread. Publication consumes only those validated artifacts.
