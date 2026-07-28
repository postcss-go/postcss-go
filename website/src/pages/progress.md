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

- [x] Go tokenizer, parser, AST, processor, stringifier, source-map layer, JSON-RPC bridge, Node service, and WASM service are implemented.
- [x] The current Node N-API addon provides synchronous in-process parse and stringify transport with a compact binary AST.
- [x] The JavaScript plugin runtime implements the baseline plugin lifecycle over the postcss-go AST.
- [x] Remove every production runtime and type dependency on the `postcss` package.
- [ ] Complete the documented PostCSS-compatible public API using postcss-go-owned implementations.
- [ ] Export and validate the complete N-API synchronous API.
- [ ] Build, test, and publish every declared native platform package.

## Required completion criteria

### Zero PostCSS production dependency

- [x] Remove every production `import`, `require`, and type reference to `postcss`.
- [x] Remove the `postcss` runtime, peer, optional, and transitive dependency from `@postcss-go/core`.
- [x] Replace `postcss-load-config` and `postcss-reporter` with postcss-go-owned configuration loading and reporting.
- [x] Implement plugin helpers, AST classes, parsing, stringifying, results, warnings, and errors without loading PostCSS.
- [x] Remove PostCSS class `Symbol.hasInstance` patches and other runtime coupling.
- [x] Remove every execution path that falls back to the `postcss` package.
- [x] Keep PostCSS only as a development/test dependency for differential tests, upstream fixtures, and benchmarks.
- [ ] Verify a clean packed-package installation with `npm ls postcss`.

### Public JavaScript API

- [x] Implement the PostCSS-compatible entry point and processor lifecycle within the documented compatibility scope.
- [ ] Complete postcss-go-owned `Processor`, result, input, previous-map, warning, and syntax-error parity.
- [x] Export postcss-go-owned plugin, result, input, warning, syntax, parser, stringifier, source-map, and process-option types.
- [x] Provide explicit asynchronous `parse`, `process`, and `stringify` APIs.
- [x] Provide explicit synchronous `parseSync`, `processSync`, `stringifySync`, and `noWorkSync` APIs.
- [x] Document compatibility differences instead of reproducing implicit `LazyResult` behavior where it conflicts with explicit sync/async APIs.
- [x] Implement the baseline Node/Container method, mutation, traversal, JSON, and proxy surface.
- [ ] Complete Node/Container behavior and type parity through a dedicated upstream contract suite.
- [x] Support `fromJSON` and custom AST nodes in the JavaScript/DTO AST layer.
- [x] Preserve or explicitly diagnose custom AST nodes across native binary and WASM boundaries.
- [ ] Complete error and warning object parity, including source, input, plugin, node, line, and column metadata.
- [x] Define a postcss-go-owned custom parser, syntax, and stringifier contract.
- [x] Reject unsupported custom syntax with a stable error instead of falling back to PostCSS.

### Plugin execution

- [x] Support plugin normalization, `postcssPlugin`, `prepare`, `Once`, node enter/exit visitors, and `OnceExit` ordering.
- [x] Support synchronous and asynchronous plugin callbacks and Promise rejection on the asynchronous path.
- [x] Preserve baseline AST mutation, dirty rewalk, traversal, and visitor ordering semantics.
- [x] Implement `helpers.postcss` entirely with postcss-go-owned classes and services.
- [ ] Preserve complete plugin context: `result`, `root`, `opts`, `from`, `to`, source/input data, custom messages, and `lastPlugin`.
- [ ] Complete warning, dependency message, directory-dependency message, and plugin error behavior.
- [x] Detect thenables returned by supported synchronous extension points: plugin creators, `prepare`, visitors, `Once`, `OnceExit`, and annotation callbacks.
- [x] Throw a stable asynchronous-plugin error from `processSync()` instead of waiting or switching execution modes.
- [ ] Provide stable diagnostics for unsupported plugin features without loading PostCSS.
- [ ] Validate representative real plugins, including mutation-heavy and asynchronous plugins.
- [ ] Run the same plugin contract suite against native, stdio, WASM Worker, and upstream PostCSS reference behavior.

### Node N-API and synchronous execution

- [x] Implement an in-process Node N-API addon for parse, process, no-work, and stringify operations.
- [x] Replace JSON/stdio AST transport on the native path with the compact binary AST codec.
- [x] Hydrate and serialize live JavaScript AST nodes on the native plugin path.
- [x] Add synchronous native parse and stringify service methods.
- [x] Add synchronous process, no-work, and source-map generation service methods.
- [x] Add a fully synchronous plugin runner that does not enter a Promise or microtask path.
- [x] Export `parseSync`, `processSync`, `stringifySync`, and `noWorkSync` from the public package.
- [x] Expose service and default backend capabilities so callers can determine whether synchronous execution is available.
- [x] Throw a stable `SyncBackendUnavailableError` when a synchronous API is used without the N-API backend.
- [x] Keep `process()` asynchronous and able to run both synchronous and asynchronous plugins on every supported async backend.
- [x] Document that synchronous processing blocks the Node.js event loop and recommend async or Worker Thread execution for server workloads.
- [ ] Define Worker Thread ownership, native cleanup, panic/error translation, and process shutdown behavior.
- [ ] Build native binaries for supported macOS, Linux glibc, Linux musl, and Windows targets.
- [ ] Make missing native artifacts fatal in release builds while preserving an explicit async stdio fallback at runtime.
- [ ] Pack, install, load, and smoke-test every platform package before publication.

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
- [ ] Ensure Node, CLI, WASM, Go API, and source-map behavior share the same documented compatibility contract.

### Node CLI and package boundary

- [x] Replace the previous PostCSS plugin-chain execution in `packages/postcss-go/src/engine.ts` with the postcss-go plugin runtime.
- [ ] Define a standalone configuration contract for plugins, parser, syntax, stringifier, maps, and environment context.
- [x] Load `.js`, `.mjs`, and `.cjs` configuration without `postcss-load-config`.
- [x] Format warnings, errors, and dependency messages without `postcss-reporter`.
- [x] Remove the `postcss` peer dependency without replacing it with another runtime path to PostCSS.
- [ ] Report the backend used for processing and whether a fallback from native to async stdio occurred.
- [ ] Update package README, type declarations, examples, compatibility tables, and migration documentation.

### Browser and WASM

- [x] Provide the current Worker/WASM JSON service surface.
- [x] Provide a Worker-backed asynchronous WASM backend.
- [ ] Run real-browser parse, process, no-work, stringify, source-map, error, and shutdown tests.
- [ ] Support asynchronous plugins through the browser runtime within the documented contract.
- [ ] Define stable errors for synchronous plugins and other unsupported Worker features.
- [ ] Decide whether an initialized main-thread WASM backend is required for opt-in synchronous browser operations.
- [ ] If main-thread synchronous WASM is implemented, expose the same explicit sync API and async-plugin rejection rules as Node N-API.
- [ ] Document CSP, cross-origin isolation, asset loading, `SharedArrayBuffer`, and non-SAB behavior.
- [ ] Test native Node, stdio Node, Node WASM, browser main-thread WASM when supported, and browser Worker backends against the shared contract.

## Optional performance work

The current compact binary AST transfers the tree once before JavaScript plugin
execution and once before final stringification. A persistent opaque-handle AST
is an optimization, not a prerequisite for removing PostCSS or exposing the
N-API synchronous API.

- [ ] Benchmark real one-, three-, five-, ten-, and thirty-plugin pipelines before replacing binary whole-tree transfer.
- [ ] Prototype an opaque Go AST handle ABI with stable identity, generation checks, explicit disposal, and detached-node lifetime.
- [ ] Prototype cached field reads, batched reads, mutation batches, and visitor cursors.
- [ ] Compare native handles, cached handles, binary transfer, stdio, and WASM using real plugins.
- [ ] Adopt handle-backed nodes only where measured end-to-end results outperform the binary AST path.
- [ ] Retain the binary AST and DTO protocols as compatibility and unsupported-platform fallbacks.

## Validation and release gates

- [ ] Run the complete Go, TypeScript, package, CLI, WASM, and upstream differential suites.
- [ ] Run the shared plugin and AST contract suite across every supported backend.
- [ ] Pack `@postcss-go/core` and all platform packages into tarballs.
- [ ] Install the tarballs in clean projects without workspace links.
- [ ] Verify the packed dependency tree contains no `postcss`, `postcss-load-config`, or `postcss-reporter`.
- [ ] Verify async processing with synchronous and asynchronous plugins.
- [ ] Verify N-API `parseSync`, `processSync`, `stringifySync`, and `noWorkSync`.
- [ ] Verify `processSync()` rejects every Promise-returning extension point.
- [ ] Verify the async stdio fallback never claims synchronous capability.
- [ ] Verify native artifact presence and loading on every published target.
- [ ] Publish only after all required completion criteria and release gates pass.

## Implementation order

- [x] Establish the Go CSS data-path baseline.
- [x] Implement the current JavaScript AST facade and baseline plugin runtime.
- [x] Implement the compact binary N-API transport.
- [x] Introduce postcss-go-owned public contracts and remove production PostCSS types.
- [x] Replace `helpers.postcss`, class coupling, custom-syntax fallback, configuration loading, and reporting.
- [x] Remove all production and published-package dependencies on PostCSS.
- [x] Implement the explicit synchronous service and plugin execution path.
- [ ] Export and test the complete sync and async public APIs.
- [ ] Complete result, input, warning, error, plugin-context, and custom-syntax compatibility.
- [ ] Run real-plugin and cross-backend contract suites.
- [ ] Complete the native build, packaging, installation, and publication matrix.
- [ ] Update public compatibility and migration documentation.
- [ ] Evaluate opaque AST handles only after the required replacement target is complete and benchmarked.
