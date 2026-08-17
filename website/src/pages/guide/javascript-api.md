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
| Service | Worker-backed native by default       | In-process native N-API                       |

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

`parseAst` returns the serializable AST DTO from the service. `stringifyAst` and
`toResult` remain available as lower-level helpers. Public `process()` and
`toResult()` return a live `Root` (or `Document`) with shared `Input` metadata,
matching `parse()` and `Processor#process()`. `toResult` generates source maps
through `stringifyResult` so Document structure is preserved.

`postcss.parse` / `helpers.postcss.parse` use the in-process N-API parser, the
same Go tokenizer as `parseSync()`. `Node#toString()` and
`helpers.postcss.stringify` use the Go stringifier. On the browser WASM Worker
path those synchronous helpers throw `SyncBackendUnavailableError`.

## Source maps

PostCSS-shaped `map` options are normalized before they cross the bridge. Go
owns previous-map loading and composition, identity maps for empty plugin
pipelines, annotation cleanup, inline/external `sourceMappingURL` emission, and
the resolved external map filename for process, no-work, and stringify.
JavaScript callback options (`map.prev` and `map.annotation`) are evaluated once
at the API boundary; `map.prev` must be synchronous, while annotation callbacks
may be async and receive a live PostCSS-shaped root. `PreviousMap` exposes owned
annotation, inline-map, JSON, and source-content metadata to JavaScript callers.
`Result.mapFile` surfaces the external map path reported by Go.

## Explicit synchronous APIs

`parseSync`, `processSync`, `stringifySync`, and `noWorkSync` use the in-process
Node N-API backend and never wait on a Promise. If the native addon is unavailable they throw
`SyncBackendUnavailableError`.

Use `getBackendCapabilities()` to inspect the default asynchronous backend and
whether a synchronous backend is installed. Each service also exposes a stable
`capabilities` object, including `backendWorkOffMainThread`. Setting
`POSTCSS_GO_DISABLE_NATIVE=1` explicitly disables native discovery, which is
useful when validating missing-native diagnostics or an explicitly selected
platform-package failure.

Every processing result exposes `result.backend`, identifying the backend that
actually parsed and stringified that result (`native` in Node and
`wasm-worker` for the browser service). This is separate from capability
discovery: availability answers what can run; `result.backend` answers what did
run.

`processSync()` rejects a Promise or thenable returned by a plugin creator,
`prepare`, a visitor, `Once`, `OnceExit`, or a map annotation callback with
`AsyncPluginError`. Use `process()` for asynchronous plugins.

`helpers.postcss.parse`, AST string insertion (`root.append('.a{}')`),
`Node#toString()`, and `helpers.postcss.stringify` use the same in-process N-API
Go parser/stringifier as `parseSync()` / `stringifySync()`. On the browser WASM
Worker path those helpers throw `SyncBackendUnavailableError`; plugins may still
mutate already-hydrated nodes and construct AST objects without parsing or
stringifying CSS.

Synchronous parsing and processing block the Node.js event loop. Prefer the
asynchronous API for server request paths. Promise-returning APIs prefer the
native addon's `napi_async_work` methods, which execute Go outside the Node.js
main thread. The default is intentionally native-required: when the compatible
async addon is unavailable, Promise-returning APIs throw
`AsyncBackendUnavailableError` instead of silently changing transports.

`stringifySync(root, builder)` replays Go stringifier chunks through the
PostCSS-shaped builder callback. `stringifySync(root, options)` returns a string
via N-API; the two call forms are explicit and do not select a backend
implicitly.

## Engine and service

Public Promise-returning APIs and the CLI share the same worker-backed native
backend. Node has no transport-selection environment variable. The
browser-compatible service is exposed through `@postcss-go/core/wasm`
(`BrowserPostcssGoService`, `createBrowserProcessor`, and the WASM assets), not
the main Node entry. The lower-level `@postcss-go/core/browser` module is also
available. See [Browser and WASM](./browser-wasm/) for CSP, asset loading, and
the async-only contract.

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
