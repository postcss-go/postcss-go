# Architecture

A fast Go CSS engine behind a PostCSS-compatible JavaScript surface. The Go core owns the hot path; Node and browser packages own ecosystem integration.

## System overview

```mermaid
flowchart LR
    Input[CSS input] --> CLI[Node.js CLI / API]
    CLI --> Plugins[PostCSS plugin chain]
    Plugins --> Service[PostcssGoService]
    Service --> Bridge[Node-API native addon]
    Bridge --> Core[Go core engine]
    Core --> Output[CSS, AST, warnings, source map]
    Service --> Browser[Browser / WASM service]
```

- **Go core** — parse, canonical AST operations, stringify, warnings, source maps
- **Node.js packages** — public API, CLI, plugin loading, and the AST facade required by JavaScript plugins
- **Native boundary** — one private C ABI dispatcher behind sync calls and Node-API async work
- **Browser / WASM** — same service contract as Node, via a Worker and Go WASM

## Processing pipeline

```text
CSS → tokenizer → parser → AST → plugins → stringifier → Result
```

`postcss.New(...).Process(css, options)` parses input, runs plugin hooks (`Prepare` → `Once` → enter/exit visitors → `OnceExit`), then stringifies. Source-map generation, previous-map composition, and annotation emission are Go-owned. Errors stop the run; warnings accumulate on `Result.Messages`.

## AST model

Five node kinds: `Root`, `Rule`, `AtRule`, `Declaration`, `Comment`. Nodes share parent links, source ranges, and formatting metadata (`Raws`), so output can stay faithful to the input.

## Go packages

| Package       | Responsibility                     |
| ------------- | ---------------------------------- |
| `tokenizer`   | Lexical scanning                   |
| `parser`      | AST construction                   |
| `ast`         | Node types, mutation, traversal    |
| `processor`   | Plugin lifecycle and orchestration |
| `sourcemap`   | Inputs, locations, previous maps   |
| `stringifier` | CSS output and generated maps      |
| `result`      | CSS, root, maps, warnings          |
| `postcss`     | Public Go facade                   |

The tokenizer never builds AST nodes; the parser never runs plugins; the processor coordinates without owning tokenization or serialization.

## Native Node boundary

```text
TypeScript service → Node-API addon → internal/nativeaddon → internal/nativebridge → Go core
```

Four core operations—`parse`, `process`, `noWork`, and `stringify`—share one
private Go/C dispatcher. ASTs use the compact binary codec. Process responses
use a length-prefixed frame containing small JSON metadata followed by the raw
binary AST, avoiding base64 conversion. Promise operations run as Node-API
async work, while the explicit sync API calls the same Go operations on the
Node thread. The old production stdio child-process backend is not shipped.

Worker ownership, async-work cleanup, shutdown, and error translation are
specified in the [Node native lifecycle contract](native-lifecycle.md).

## Node.js integration

```mermaid
sequenceDiagram
    participant User as CLI / Node API
    participant Plugins as PostCSS plugins
    participant Service as PostcssGoService
    participant Go as Go bridge + core

    User->>Plugins: load config and plugins
    Plugins->>Service: parse / process / noWork / stringify
    Service->>Go: Node-API call (binary AST)
    Go-->>Service: CSS, AST, map, warnings
    Service-->>User: PostCSS-shaped result
```

- **service** — shared async contract
- **native** — addon loading, async-work and sync surfaces; map-option normalization via the private shared helpers bundled into core
- **browser** — Worker-backed service; `@postcss-go/wasm` ships the WASM assets
- **cli** — config, JS plugins, message combining, writing Go-generated CSS and maps
- **shared** — private dual ESM/CJS helpers for map-option normalization, annotation callbacks, map paths, and map-mode predicates; bundled into core and used directly by vendored compat overrides

JavaScript stays responsible for ecosystem-facing behavior and synchronous JavaScript plugin callbacks. Go handles parse, the canonical AST implementation, process, no-work map handling, and all pipeline/plugin-result stringify and source-map generation. The TypeScript AST stringifier is only the synchronous compatibility fallback required by `Node#toString()`.

## Source maps

Ownership is split so PostCSS-shaped options stay in JavaScript while map generation stays in Go:

| Layer                   | Owns                                                                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private shared helpers  | Materialize JavaScript `map.prev` and `map.annotation` callbacks once, then normalize PostCSS-shaped options into flat bridge flags (`mapInline`, `mapAuto`, `previousMapPath`, …) |
| Node / browser / compat | Supply live PostCSS roots to callbacks, expose `PreviousMap` / `ResultMap` facades, surface Go's resolved `mapFile` on results, and write the final files reported by Go           |
| Go `processor`          | Load previous maps, compose or build maps, select inline/external output, emit `sourceMappingURL`, and report the resolved external `mapFile` for process, no-work, and stringify  |
| Go `stringifier`        | AST stringify with optional source-map annotation stripping; raw-CSS `ClearSourceMapAnnotations` for the no-work path                                                              |

Contract notes:

- CLI `processWithGoEngine` and `Processor#process` share the same plugin path: JavaScript plugins run around Go parse/stringifyResult. No second CSS `process` pass is used to compose plugin maps.
- Bridge `mapInline` is optional JSON (`*bool` in Go). Omitted means unset; `false` means explicit external/no-inline. Bare Go `Map: true` with no output-mode flags defaults to inline, matching PostCSS `map: true`.
- `process` with maps off strips only `# sourceMappingURL=` comment nodes. `noWork` without maps uses the PostCSS no-work string cleaner (`/*#` comments).
- AST source records carry previous-map text and URL across the binary boundary, so standalone and plugin-result stringify can compose maps in Go.
- CSS-provided external annotations are treated as untrusted: only regular `.map` files confined to the input directory are loaded, with a 32 MiB limit. An explicit `map.prev` path remains a trusted caller option but uses the same file type and size checks.

## Compatibility and performance

**Compatibility** — keep PostCSS-shaped AST and visitors; preserve formatting and source locations; carry source-map options through the processor and bridge; run upstream tests via `packages/postcss-compat`.

**Performance** — keep the core pipeline in Go; use the binary native boundary; measure with the fixtures in [Contributing](contributing.md).

## Testing

Tests live next to the code they protect (tokenizer, parser, AST, processor, stringifier, bridge, `@postcss-go/shared`, packages). Prefer the narrowest boundary tests first, then the broader checks from [Contributing](contributing.md).
