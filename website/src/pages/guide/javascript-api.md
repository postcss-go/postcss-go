---
layout: ../../layouts/GuideLayout.astro
title: JavaScript API
section: javascript-api
---

# JavaScript API

`@postcss-go/core` is the Node.js and TypeScript integration surface. It owns
the public classes, plugin runtime, and explicit asynchronous and synchronous
processing APIs.

## API at a glance

| Surface | Asynchronous                          | Synchronous                                   |
| ------- | ------------------------------------- | --------------------------------------------- |
| Parse   | `parse`                               | `parseSync`                                   |
| Process | `postcss(plugins).process`, `process` | `postcss(plugins).processSync`, `processSync` |
| Output  | `stringify`                           | `stringifySync`                               |
| No work | `noWork`                              | `noWorkSync`                                  |
| Service | `createNodeService`                   | N-API backend selected by the sync helpers    |

## Processor lifecycle

The default export is the PostCSS-compatible entry point. It returns a reusable
postcss-go-owned `Processor`; processing resolves to a postcss-go-owned
`Result`, never to a PostCSS `LazyResult`.

```ts
import postcss from '@postcss-go/core';

const result = await postcss([
  {
    postcssPlugin: 'to-blue',
    Declaration(decl) {
      if (decl.prop === 'color') decl.value = 'blue';
    },
  },
]).process('.button { color: red }', { from: 'input.css' });

console.log(result.css);
```

Plugins receive live postcss-go `Root`, `Rule`, `Declaration`, and other node
instances. `result`, `result.opts`, messages, warnings, `lastPlugin`, and
`helpers.postcss` are implemented by this package.

## Parse and stringify

```ts
import { parse, stringify } from '@postcss-go/core';

const root = await parse('.button { color: red; }');
root.walkDecls((decl) => {
  if (decl.prop === 'color') decl.value = 'tomato';
});

console.log(await stringify(root));
```

| Function                   | Purpose                                                    |
| -------------------------- | ---------------------------------------------------------- |
| `parse(css, options)`      | Resolve to a live PostCSS-shaped AST root.                 |
| `process(css, options)`    | Run the Go CSS pipeline without a JavaScript plugin chain. |
| `stringify(root, options)` | Resolve to serialized CSS.                                 |
| `noWork(css, options)`     | Apply no-plugin source-map behavior.                       |

`parseAst`, `stringifyAst`, and `toResult` remain available as lower-level
service-oriented helpers. Public `process()` returns a live `Root` (or
`Document`) with shared `Input` metadata, matching `parse()` and
`Processor#process()`.

`postcss.parse` / `helpers.postcss.parse` use the owned synchronous JavaScript
parser so plugins can insert CSS without requiring the N-API backend.
`parseSync` uses the Go/native parser. Prefer `parse`/`parseSync` for
pipeline input; use `postcss.parse` inside plugin helpers.

## Source maps

PostCSS-shaped `map` options are normalized before they cross the bridge. Go
owns previous-map loading and composition, identity maps for empty plugin
pipelines, annotation cleanup, and inline/external `sourceMappingURL` emission.
`PreviousMap` exposes owned annotation, inline-map, JSON, and source-content
metadata to JavaScript callers.

## Explicit synchronous APIs

`parseSync`, `processSync`, `stringifySync`, and `noWorkSync` use the in-process
Node N-API backend. They never start the stdio bridge and never wait on a
Promise. If the native addon is unavailable they throw
`SyncBackendUnavailableError`.

Use `getBackendCapabilities()` to inspect the default asynchronous backend and
whether a synchronous backend is installed. Each service also exposes a stable
`capabilities` object. Setting `POSTCSS_GO_DISABLE_NATIVE=1` explicitly disables
native discovery, which is useful when validating async-only deployments.

`processSync()` rejects a Promise or thenable returned by a plugin creator,
`prepare`, a visitor, `Once`, `OnceExit`, or a map annotation callback with
`AsyncPluginError`. Use `process()` for asynchronous plugins.

Synchronous parsing and processing block the Node.js event loop. Prefer the
asynchronous API or a Worker Thread for server request paths. The default
`Processor#process()` path uses the asynchronous stdio service so Go parsing
and stringifying do not run on the Node.js main thread. Callers that explicitly
inject `createNativeService()` into `Processor#process()` opt into synchronous
native work behind a Promise-shaped API and should use a Worker Thread when
main-thread latency matters.

`stringifySync(root, builder)` is the owned JavaScript builder adapter required
by the PostCSS-shaped API. `stringifySync(root, options)` returns a string via
N-API; the two call forms are explicit and do not select a backend implicitly.

## Engine and service

Use `createNodeService` when several asynchronous operations should share one
persistent Go bridge. `createGoEngine` and `processWithGoEngine` provide the
CLI-oriented reusable engine. Unlike the public Promise-returning APIs, the CLI
engine prefers the in-process native backend when the addon is available because
the CLI already owns a dedicated process. Set `POSTCSS_GO_BRIDGE=stdio` (or
`child`) to force the asynchronous stdio backend. The browser-compatible service
is exposed through the package's `./browser` entry point.

## Compatibility boundary

JavaScript plugins, configuration loading, AST helpers, warnings, errors,
inputs, previous maps, and result objects are implemented by
`@postcss-go/core`; the production package does not load `postcss`.

postcss-go deliberately does not reproduce implicit `LazyResult` execution:
`process()` always returns a `Promise<Result>`, while `processSync()` returns a
`Result` immediately. Reading `.css`, calling `.toString()`, or awaiting an
unstarted result never triggers work.

The exported `Parser`, `CustomParser`, `Syntax`, `CustomStringifier`, `StringifierBuilder`,
`SourceMap`, and `ProcessOptions` types define the public extension boundary.
Custom parser, syntax, and stringifier values are currently rejected with
`UnsupportedSyntaxError` before crossing a Go backend. Custom AST node types
are rejected with `UnsupportedAstNodeError` at native and WASM codec boundaries
instead of being dropped or converted to a built-in node.

This rejection also applies to explicitly supplied PostCSS default parser or
stringifier delegates. Those options are redundant for postcss-go and should be
omitted; they are never identified by function name or silently discarded.
