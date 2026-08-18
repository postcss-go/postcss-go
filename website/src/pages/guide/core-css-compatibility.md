---
layout: ../../layouts/GuideLayout.astro
title: Core CSS compatibility
section: core-css-compatibility
---

# Core CSS compatibility

The Go API, Node pipeline APIs, CLI plugin path, and browser WASM Worker share
the Go tokenizer, parser, stringifier, and source-map implementation on their
service-backed paths. Node's synchronous compatibility helpers also use those
Go implementations; JavaScript hydrates the resulting AST for plugin callbacks.
The PostCSS-compat tokenizer override is the same Go tokenizer: token kinds,
UTF-16 offsets, unclosed errors, and `ignoreUnclosed` come from Go.

The default parser produces a `Root`. `Document` is a constructed container
that the AST, codec, processor, and stringifier accept; it is not parsed from
CSS by the default parser. Public `parse()` / `parseSync()` reject a Document
root.

## Shared contract

| Behavior                                                                 | Go API | Node API | CLI | WASM Worker |
| ------------------------------------------------------------------------ | ------ | -------- | --- | ----------- |
| Parse Root, Rule, AtRule, Declaration, and Comment nodes                 | Yes    | Yes      | Yes | Yes         |
| Preserve valid input formatting when the AST is unchanged                | Yes    | Yes      | Yes | Yes         |
| Serialize constructed Document containers                                | Yes    | Yes      | —   | Yes         |
| Report `CssSyntaxError` with Go source, line, column, and reason         | Yes    | Yes      | Yes | Yes         |
| Generate version 3 source maps with non-empty mappings and input sources | Yes    | Yes      | Yes | Yes         |
| Load and compose previous maps; control inline/external annotations      | Yes    | Yes      | Yes | Yes         |

The shared conformance scenarios cover normalized AST shape and source ranges,
exact parse/stringify round-trips, constructed Documents, mutation, external
and inline source maps, decoded mapping positions, `sourcesContent`, previous-map
composition, no-work annotation cleanup, and syntax-error positions and reasons.
They run through the public Go facade, public Node async and sync APIs, the Node
native service, the executable CLI (with an identity plugin so the parse path
runs), the real Go WASM binary, and a real browser Worker. Plugin context,
warnings, dependency messages, mutation-heavy visitors, and asynchronous plugins
are covered by the shared plugin contract suite against native, WASM Worker, and
upstream PostCSS.

The CLI uses the shared `noWork` path when no plugins are configured. That
path updates map annotations without parsing or re-stringifying otherwise
unchanged CSS. Invalid CSS is diagnosed only on a parse path, so the CLI
contract for syntax errors uses a plugin.

## Surface-specific differences

The compatibility contract covers CSS behavior, not execution mechanics:

- Node's Promise APIs and the CLI require the native addon and run Go work off
  the main thread. Explicit sync APIs, `postcss.parse`, AST string insertion,
  `Node#toString()`, and builder callbacks use the in-process N-API backend.
- Browser processing is asynchronous and Worker-only. Synchronous plugin
  helpers such as `helpers.postcss.parse`, AST string insertion, and
  `Node#toString()` throw `SyncBackendUnavailableError`; it does not expose a
  synchronous WASM path.
- The Go API accepts Go-native `Plugin`/`Visitor` values. Those visitors walk
  the tree once and do not dirty-rewalk. Node, CLI, and browser surfaces accept
  supported JavaScript plugins through the owned JavaScript runtime, which does
  dirty-rewalk.
- Custom parser, syntax, and stringifier delegates are rejected with a stable
  `UnsupportedSyntaxError`; no surface falls back to PostCSS.

For map output, a bare enabled map uses the PostCSS-compatible inline default.
Explicit external mode returns or writes JSON and emits a version 3 map. The
CLI's `--map` flag selects external output, while `--no-map` disables it.

CI runs these scenarios as a required `test:core-css-contract` gate after
building the native and WASM artifacts. Required Node/native cases do not skip
when the addon is missing, and the browser job repeats the fixture through the
published classic Worker assets.
