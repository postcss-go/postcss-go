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

### Node CLI and package boundary

- [x] Replace `runPluginChain()` in `packages/postcss-go/src/engine.ts` with the new plugin runtime/bridge.
- [ ] Replace or isolate `postcss-load-config` and `postcss-reporter` runtime coupling.
- [ ] Define the config contract for plugins, parser, syntax, and stringifier without relying on PostCSS types.
- [ ] Remove the `postcss` peer dependency, or document it as an intentional compatibility dependency.
- [ ] Update package README, type declarations, examples, and migration documentation.

### Browser and WASM

- [x] Provide a Worker/WASM service surface.
- [ ] Reuse the plugin and AST protocol in the WASM runtime.
- [ ] Provide browser-side async plugin, source-map, warning, error, and worker shutdown parity.
- [ ] Define browser fallback behavior for custom syntax and unsupported plugins.

## Scope and completion criteria

- [ ] Go owns the complete parse, stringify, tokenizer, processor, visitor, warning, result, map, previous-map, and no-work-result behavior.
- [ ] The JavaScript compatibility layer no longer depends on PostCSS Node, processor, stringifier, or map internals for supported behavior.
- [ ] Real synchronous and asynchronous JavaScript plugins work through the new plugin bridge.
- [ ] Custom parser, syntax, and stringifier support boundaries are explicit and documented.
- [ ] Installing `@postcss-go/core` does not implicitly require PostCSS, unless that dependency is intentionally retained.
- [ ] Node, CLI, WASM, Go API, and source-map behavior share the same documented compatibility contract.

## Implementation order

- [x] Establish the current Go CSS data-path baseline.
- [ ] Inventory the public PostCSS API and separate Go-owned behavior from JavaScript fallback behavior.
- [ ] Prototype a persistent plugin callback bridge.
- [ ] Implement processor, visitor, warning, and asynchronous plugin parity through that bridge.
- [x] Move builder stringifier, map, and no-work-result paths to Go.
- [ ] Choose and implement either a drop-in PostCSS API or an explicit independent API with migration guidance.
- [ ] Remove PostCSS runtime dependencies from the CLI and package boundary.
- [ ] Delete obsolete compatibility overrides and update architecture and README documentation.
