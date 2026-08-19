---
layout: ../layouts/ProgressLayout.astro
title: Progress
---

## Product target

`postcss-go` is an independent Go-backed implementation of the PostCSS public
API and plugin model. Production source, published packages, the CLI, and every
runtime backend must work without installing or loading the `postcss` package.

The target Node.js package will provide a PostCSS-compatible public surface
implemented and owned by postcss-go. This includes the entry point and
processor, AST classes and constructors, parsing and stringifying helpers,
plugin helpers, results, inputs, warnings, errors, source maps, and public TypeScript
contracts.

PostCSS remains available only in development fixtures, differential tests, the
vendored upstream compatibility suite, and benchmarks. Unsupported behavior
must produce a stable diagnostic; it must never silently fall back to PostCSS.

## Current status

- [x] Go tokenizer, parser, AST, processor, stringifier, source-map layer, native Node service, and WASM service are implemented.
- [x] The Node N-API addon provides async-work and synchronous parse, process, no-work, stringify, and builder-stringify operations with a compact binary AST.
- [x] The JavaScript plugin runtime implements the PostCSS plugin lifecycle over the postcss-go AST, including context, messages, sync thenable rejection, and the native/WASM/upstream contract suite.
- [x] Remove every production runtime and type dependency on the `postcss` package.
- [x] Complete the documented PostCSS-compatible public API using postcss-go-owned implementations.
- [x] Export and validate the complete N-API synchronous API.
- [ ] Build, test, and publish every declared native platform package.

## Required completion criteria

### Zero PostCSS production dependency

- [x] Remove every production `import`, `require`, and type reference to `postcss`.
- [x] Remove the `postcss` runtime, peer, optional, and transitive dependency from `postcss-go`.
- [x] Replace `postcss-load-config` and `postcss-reporter` with postcss-go-owned configuration loading and reporting.
- [x] Implement plugin helpers, AST classes, parsing, stringifying, results, warnings, and errors without loading PostCSS.
- [x] Remove PostCSS class `Symbol.hasInstance` patches and other runtime coupling.
- [x] Remove every execution path that falls back to the `postcss` package.
- [x] Keep PostCSS only as a development/test dependency for differential tests, upstream fixtures, and benchmarks.
- [x] Verify a clean packed-package installation with `npm ls postcss`.

### Public JavaScript API

- [x] Implement the PostCSS-compatible entry point and processor lifecycle within the documented compatibility scope.
- [x] Complete postcss-go-owned `Processor`, result, input, previous-map, warning, and syntax-error parity.
- [x] Export postcss-go-owned plugin, result, input, warning, syntax, parser, stringifier, source-map, and process-option types.
- [x] Provide explicit asynchronous `parse`, `process`, and `stringify` APIs.
- [x] Provide explicit synchronous `parseSync`, `processSync`, `stringifySync`, and `noWorkSync` APIs.
- [x] Document compatibility differences instead of reproducing implicit `LazyResult` behavior where it conflicts with explicit sync/async APIs.
- [x] Implement the baseline Node/Container method, mutation, traversal, JSON, and proxy surface.
- [x] Complete Node/Container behavior and type parity through a dedicated upstream contract suite.
- [x] Support `fromJSON` and custom AST nodes in the JavaScript/DTO AST layer.
- [x] Preserve or explicitly diagnose custom AST nodes across native binary and WASM boundaries.
- [x] Complete error and warning object parity, including source, input, plugin, node, line, and column metadata.
- [x] Define a postcss-go-owned custom parser, syntax, and stringifier contract.
- [x] Reject unsupported custom syntax with a stable error instead of falling back to PostCSS.

### Plugin execution

This section is the JavaScript plugin runtime used by Node, the CLI, and the
browser WASM Worker. Go-native `Plugin`/`Visitor` values in `pkg/api` are a
separate API: they share parse, stringify, and source maps with the JavaScript
path, but they walk the tree once and do not dirty-rewalk.

- [x] Support plugin normalization, `postcssPlugin`, `prepare`, `Once`, node enter/exit visitors, and `OnceExit` ordering.
- [x] Support synchronous and asynchronous plugin callbacks and Promise rejection on the asynchronous path.
- [x] Preserve baseline AST mutation, dirty rewalk, traversal, and visitor ordering semantics.
- [x] Implement `helpers.postcss` entirely with postcss-go-owned classes and services.
- [x] Preserve complete plugin context: `result`, `root`, `opts`, `from`, `to`, source/input data, custom messages, and `lastPlugin`.
- [x] Complete warning, dependency message, directory-dependency message, and plugin error behavior.
- [x] Detect thenables returned by supported synchronous extension points: plugin creators, `prepare`, visitors, `Once`, `OnceExit`, and annotation callbacks.
- [x] Throw a stable asynchronous-plugin error from `processSync()` instead of waiting or switching execution modes.
- [x] Provide stable diagnostics for unsupported plugin features without loading PostCSS.
- [x] Validate `postcss-import` on native against upstream PostCSS, and mutation-heavy plus asynchronous plugin fixtures across native and WASM Worker.
- [x] Land the plugin contract suite against native, WASM Worker, and upstream PostCSS. Re-running it at publish time is a Validation gate.

### Node N-API and synchronous execution

- [x] Implement an in-process Node N-API addon for parse, process, no-work, and stringify operations.
- [x] Use the compact binary AST codec for the native path.
- [x] Hydrate and serialize live JavaScript AST nodes on the native plugin path.
- [x] Add synchronous native parse and stringify service methods.
- [x] Add synchronous process, no-work, and source-map generation service methods.
- [x] Add a fully synchronous plugin runner that does not enter a Promise or microtask path.
- [x] Run Go compute for Promise-returning native operations through Node-API async work instead of on the Node.js main thread.
- [x] Use the same native-required asynchronous backend for CLI and public JavaScript APIs.
- [x] Export `parseSync`, `processSync`, `stringifySync`, and `noWorkSync` from the public package.
- [x] Expose service and default backend capabilities so callers can determine whether synchronous execution is available.
- [x] Throw a stable `SyncBackendUnavailableError` when a synchronous API is used without the N-API backend.
- [x] Keep `process()` asynchronous and able to run both synchronous and asynchronous plugins on every supported async backend.
- [x] Document that synchronous processing blocks the Node.js event loop and recommend async or Worker Thread execution for server workloads.
- [x] Define Worker Thread ownership, native cleanup, panic/error translation, and process shutdown behavior.
- [x] Add the build, package, and smoke-test matrix for supported macOS, Linux glibc, and Windows targets.
- [ ] Add Linux musl native packages after Go supports loading c-archive/c-shared runtimes through `dlopen` (`golang/go#54805`).
- [x] Verify that the native matrix succeeds on every declared target.
- [x] Make missing native runtime artifacts fatal; Node has no transport fallback.
- [x] Pack, install, load, and smoke-test every platform package before publication.

### Core CSS pipeline

- [x] Tokenizer implementation in `internal/tokenizer` with bridge support.
- [x] Parser support for Root, Rule, AtRule, Declaration, and Comment nodes.
- [x] AST, codec, bridge, processor, and stringifier support for Document containers.
- [x] AST mutation: append, prepend, insert, remove, replace, clone, traversal, and raw formatting helpers.
- [x] Stringifier support for raw formatting and source maps on the main path.
- [x] Structured syntax errors and bridge serialization.
- [x] Source-map generation, previous maps, annotations, and source locations on the main path.
- [x] Route all compatibility tokenizer behavior through Go.
- [x] Implement the supported builder callback adapter with node and boundary metadata.
- [x] Move map-generator, previous-map, no-work-result, and annotation normalization into the Go-owned path.
- [x] Ensure Node, CLI, WASM, Go API, and source-map behavior share the same documented compatibility contract.

### Node CLI and package boundary

- [x] Replace the previous PostCSS plugin-chain execution in `packages/postcss-go/src/engine.ts` with the postcss-go plugin runtime.
- [x] Define a standalone configuration contract for plugins, parser, syntax, stringifier, maps, and environment context.
- [x] Load `.js`, `.mjs`, and `.cjs` configuration without `postcss-load-config`.
- [x] Format warnings, errors, and dependency messages without `postcss-reporter`.
- [x] Remove the `postcss` peer dependency without replacing it with another runtime path to PostCSS.
- [x] Report native backend availability and the backend used for processing.
- [x] Update package README, type declarations, examples, compatibility tables, and migration documentation.

### Browser and WASM

- [x] Provide the current Worker/WASM JSON service surface.
- [x] Provide a Worker-backed asynchronous WASM backend.
- [x] Run real WASM Worker-protocol parse, process, no-work, stringify, source-map, error, and shutdown tests.
- [x] Support asynchronous plugins through the browser runtime within the documented contract.
- [x] Define stable errors for synchronous APIs and other unsupported Worker features (`SyncBackendUnavailableError`, `WasmWorkerError`).
- [x] Rebuild structured `CssSyntaxError` metadata from the Worker ErrorDTO (line, column, reason, source, file).
- [x] Decide that an initialized main-thread WASM backend is not required; browser remains async Worker-only (no opt-in sync WASM in v1).
- [x] Document CSP, cross-origin isolation, asset loading, `SharedArrayBuffer`, and non-SAB behavior.
- [x] Cover native Node and browser Worker backends with an expanded shared smoke contract (parse/process/stringify/noWork, source maps, syntax errors, async plugins, visitor ordering). Plugin contract coverage against native, WASM Worker, and upstream PostCSS is recorded under Plugin execution; repeating those suites at publish time remains a Validation gate.

## Optional performance work

The current compact binary AST transfers the tree once before JavaScript plugin
execution and once before final stringification. A persistent opaque-handle AST
is an optimization, not a prerequisite for removing PostCSS or exposing the
N-API synchronous API.

The Go handle ABI lives in `internal/asthandle` and is measured by
`pnpm bench:boundary` Part E. Production Node N-API exports the same handle
surface (`handleParse`, batched field I/O, cursors) for declaration-only plugin
pipelines; cached native handles beat bulk binary transfer on that visitor shape
at 1–30 plugins. They are not a full PostCSS node facade (raws, custom nodes,
dirty rewalk, Result/helpers), and the WASM Worker path still needs a
serializable tree. Production therefore keeps the compact binary AST and DTO
protocols for compatibility boundaries.

- [x] Benchmark real one-, three-, five-, ten-, and thirty-plugin pipelines before replacing binary whole-tree transfer.
- [x] Prototype an opaque Go AST handle ABI with stable identity, generation checks, explicit disposal, and detached-node lifetime.
- [x] Prototype cached field reads, batched reads, mutation batches, and visitor cursors.
- [x] Compare native handles, cached handles, binary transfer, a synthetic JSON DTO baseline, and WASM using real plugins.
- [x] Adopt handle-backed nodes only where measured end-to-end results outperform the binary AST path.
- [x] Retain the binary AST and DTO protocols for the native and WASM compatibility boundaries.

## Validation and release gates

These boxes are the publication checklist. A checked item was verified during
implementation. Unchecked items stay open until they are re-run or completed as
part of a release.

- [ ] Re-run the complete Go, TypeScript, package, CLI, WASM, and upstream differential suites.
- [ ] Re-run the shared plugin and AST contract suite across every supported backend.
- [ ] Pack `postcss-go` and all platform packages into tarballs.
- [ ] Install the tarballs in clean projects without workspace links.
- [ ] Verify the packed dependency tree contains no `postcss`, `postcss-load-config`, or `postcss-reporter`.
- [x] Verify async processing with synchronous and asynchronous plugins.
- [x] Verify N-API `parseSync`, `processSync`, `stringifySync`, and `noWorkSync`.
- [x] Verify `processSync()` rejects every Promise-returning extension point.
- [x] Verify missing native artifacts produce stable async and sync diagnostics without changing transports.
- [ ] Verify native artifact presence and loading on every published target.
- [ ] Publish only after all required completion criteria and release gates pass.

## Implementation order

- [x] Establish the Go CSS data-path baseline.
- [x] Implement the JavaScript AST facade and plugin runtime.
- [x] Implement the compact binary N-API transport.
- [x] Introduce postcss-go-owned public contracts and remove production PostCSS types.
- [x] Replace `helpers.postcss`, class coupling, custom-syntax fallback, configuration loading, and reporting.
- [x] Remove all production and published-package dependencies on PostCSS.
- [x] Implement the explicit synchronous service and plugin execution path.
- [x] Export and test the complete sync and async public APIs.
- [x] Complete result, input, warning, error, plugin-context, and custom-syntax compatibility.
- [x] Run real-plugin and cross-backend contract suites.
- [ ] Complete the native build, packaging, installation, and publication matrix.
- [x] Update public compatibility and migration documentation.
- [x] Evaluate opaque AST handles only after the required replacement target is complete and benchmarked.
