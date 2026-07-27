---
layout: ../layouts/ProgressLayout.astro
title: postcss-go compatibility progress
---

## Current status

- [x] Go tokenizer, parser, AST, processor, stringifier, source-map layer, JSON-RPC bridge, Node service, and WASM service are implemented.
- [ ] Complete replacement for the PostCSS JavaScript runtime.
- [ ] Drop-in replacement for the `postcss` package.
- [ ] Remove the remaining PostCSS runtime dependency from the Node CLI and plugin path.

## PostCSS parity work

The sections below track the user-visible compatibility limits and the engineering work required to close them.

### Core CSS pipeline

- [x] Tokenizer implementation in `internal/tokenizer` with bridge support.
- [x] Parser support for Root, Document, Rule, AtRule, Declaration, and Comment nodes.
- [x] AST mutation: append, prepend, insert, remove, replace, clone, traversal, and raw formatting helpers.
- [x] Stringifier support for raw formatting and source maps on the main path.
- [x] Structured syntax errors and bridge serialization.
- [x] Source-map generation, previous maps, annotations, and source locations on the main path.
- [x] Route all compatibility tokenizer behavior through Go.
- [x] Implement the supported builder callback adapter; Go emits builder chunks with node and boundary metadata, and the compatibility layer forwards them to PostCSS.
- [x] Move map-generator, previous-map, no-work-result, and annotation normalization into the Go-owned path.

### JavaScript API and runtime

- [ ] Match the PostCSS entry point, processor lifecycle, lazy result, result objects, input objects, previous maps, and public exports.
- [ ] Match lazy execution and synchronous/asynchronous result behavior.
- [x] Complete Node/Container method, property, JSON, custom-node, and type declaration parity.
- [ ] Complete error and warning object parity, including source/input/plugin metadata.
- [x] Complete `fromJSON` and custom AST node support.
- [ ] Define and implement the supported custom syntax/parser/stringifier contract.

### Plugin execution

- [ ] Design a persistent JavaScript↔Go plugin ABI and callback RPC protocol.
- [ ] Support plugin initialization, `postcssPlugin`, `prepare`, `Once`, node enter/exit, and `OnceExit` ordering.
- [ ] Support synchronous and asynchronous JavaScript plugins, Promise rejection, warnings, messages, and `lastPlugin`.
- [ ] Preserve AST mutation and traversal semantics across the bridge.
- [ ] Preserve plugin context: `result`, `root`, `opts`, `from`, `to`, source/input data, and custom messages.
- [ ] Provide stable diagnostics or an explicit fallback for unsupported plugins.

### Native and AST bridge

- [ ] Define an opaque Go AST handle ABI with stable node identity, generation checks, explicit tree disposal, and detached-node lifetime.
- [ ] Replace whole-tree AST serialization with handle-based field, child, traversal, clone, mutation, and stringify operations.
- [ ] Add batched field reads, mutation batches, and visitor cursors to avoid per-property bridge overhead.
- [ ] Refactor the JavaScript AST facade to support handle-backed nodes while retaining DTO-backed fallback behavior.
- [ ] Preserve PostCSS object identity, `parent`/sibling relationships, nested `raws` mutation, custom JavaScript properties, and synchronous `Node#toString()` behavior.
- [ ] Implement a Node N-API backend over the Go AST ABI.
- [ ] Define Node Worker Thread ownership, native handle cleanup, panic/error translation, and unsupported-platform fallback behavior.
- [ ] Build, test, and publish the supported macOS, Linux, and Windows native binaries.

### Node CLI and package boundary

- [x] Replace `runPluginChain()` in `packages/postcss-go/src/engine.ts` with the new plugin runtime/bridge.
- [ ] Replace or isolate `postcss-load-config` and `postcss-reporter` runtime coupling.
- [ ] Define the config contract for plugins, parser, syntax, and stringifier without relying on PostCSS types.
- [ ] Remove the `postcss` peer dependency, or document it as an intentional compatibility dependency.
- [ ] Update package README, type declarations, examples, and migration documentation.

### Browser and WASM

- [x] Provide the current Worker/WASM JSON service surface.
- [ ] Implement the shared opaque-handle AST protocol for Node and browser WASM.
- [ ] Provide an initialized main-thread WASM backend for opt-in synchronous AST operations.
- [ ] Provide the default Worker-backed asynchronous WASM backend.
- [ ] Define whether `SharedArrayBuffer` is used only for batched transport; document cross-origin isolation requirements and the non-SAB fallback.
- [ ] Preserve handle identity, mutation, traversal, error, warning, source-map, and disposal semantics across native and WASM backends.
- [ ] Provide browser-side async plugin, source-map, warning, error, and worker shutdown parity.
- [ ] Define browser fallback behavior for synchronous plugins, custom syntax, and unsupported runtime features.
- [ ] Test native Node, Node WASM, browser main-thread WASM, and browser Worker backends against the same compatibility contract.

## Scope and completion criteria

- [ ] Go owns the complete parse, stringify, tokenizer, processor, visitor, warning, result, map, previous-map, and no-work-result behavior.
- [ ] The JavaScript compatibility layer no longer depends on PostCSS Node, processor, stringifier, or map internals for supported behavior.
- [ ] Real synchronous and asynchronous JavaScript plugins work through the new plugin bridge.
- [ ] Supported JavaScript AST operations use stable Go AST handles without whole-tree serialization at plugin boundaries.
- [ ] Native and WASM backends expose the same AST behavior while documenting runtime-specific synchronous and asynchronous limits.
- [ ] Custom parser, syntax, and stringifier support boundaries are explicit and documented.
- [ ] Installing `@postcss-go/core` does not implicitly require PostCSS, unless that dependency is intentionally retained.
- [ ] Node, CLI, WASM, Go API, and source-map behavior share the same documented compatibility contract.

## Implementation order

- [x] Establish the current Go CSS data-path baseline.
- [ ] Inventory the public PostCSS API and separate Go-owned behavior from JavaScript fallback behavior.
- [ ] Define the opaque Go AST handle ABI, lifecycle rules, and DTO fallback contract.
- [ ] Refactor the JavaScript AST facade around a transport-independent handle backend.
- [ ] Implement and benchmark batched reads, mutation batches, and visitor cursors.
- [ ] Implement the Node N-API backend and native release pipeline.
- [ ] Prototype a persistent plugin callback bridge.
- [ ] Implement processor, visitor, warning, and asynchronous plugin parity through that bridge.
- [ ] Implement Node WASM, browser main-thread WASM, and browser Worker backends in that order.
- [ ] Run the shared AST and plugin compatibility suite across every supported backend.
- [x] Move builder stringifier, map, and no-work-result paths to Go.
- [ ] Choose and implement either a drop-in PostCSS API or an explicit independent API with migration guidance.
- [ ] Remove PostCSS runtime dependencies from the CLI and package boundary.
- [ ] Delete obsolete compatibility overrides and update architecture and README documentation.
