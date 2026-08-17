---
layout: ../../layouts/GuideLayout.astro
title: Browser and WASM
section: browser-wasm
---

# Browser and WASM

`@postcss-go/core/wasm` ships a classic Web Worker, Go's `wasm_exec.js`, and the
`postcss-go.wasm` binary. Parsing and stringifying run off the page main thread.
JavaScript plugins still run on the calling thread through
`createBrowserProcessor`.

## Quick start

```ts
import { createBrowserProcessor } from '@postcss-go/core/wasm';

const processor = createBrowserProcessor(
  [
    {
      postcssPlugin: 'to-blue',
      async Declaration(decl) {
        if (decl.prop === 'color') decl.value = 'blue';
      },
    },
  ],
  {
    workerUrl: '/postcss-go/worker.js',
    wasmUrl: '/postcss-go/postcss-go.wasm',
    wasmExecUrl: '/postcss-go/wasm_exec.js',
  },
);

const result = await processor.process('.a { color: red }', { from: 'a.css' });
console.log(result.css, result.backend); // "wasm-worker"
await processor.close();
```

Use `BrowserPostcssGoService` directly when you only need parse, process,
no-work, or stringify without JavaScript plugins.

## Contract

| Surface                                                                                             | Browser WASM Worker                         |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Async parse / process / no-work / stringify                                                         | Supported                                   |
| JavaScript plugins (sync and async callbacks)                                                       | Supported via `createBrowserProcessor`      |
| `helpers.postcss.parse`, `Container#append(string)`, `Node#toString()`, `helpers.postcss.stringify` | Rejected with `SyncBackendUnavailableError` |
| Explicit sync APIs (`parseSync`, `processSync`, …)                                                  | Rejected with `SyncBackendUnavailableError` |
| Main-thread synchronous WASM                                                                        | Not provided; deferred                      |
| Classic Worker + `importScripts`                                                                    | Required                                    |
| Module Worker                                                                                       | Unsupported (`WasmWorkerError`)             |

Browser remains asynchronous and Worker-backed. An initialized main-thread WASM
backend is intentionally out of scope for v1: sync Go work on the UI thread
would freeze the page, and Node already covers sync through N-API.

Plugins may mutate the hydrated JavaScript AST (change declaration values,
construct `Rule` / `Declaration` nodes, walk). They must not parse CSS strings,
insert CSS source, or stringify the live tree with `helpers.postcss.parse`,
`root.append('.a{}')`, `Node#toString()`, or `helpers.postcss.stringify`: those
helpers are synchronous and the Worker cannot service them. Callers that need
that PostCSS plugin surface should use Node with the N-API backend. Pipeline
stringify stays in the Worker.

## Asset loading

Bundlers must emit three assets as fetchable URLs:

1. `worker.js` — classic Worker entry (`@postcss-go/core/wasm/worker`)
2. `postcss-go.wasm` — Go runtime binary
3. `wasm_exec.js` — Go's JavaScript WASM glue

For a bundler-neutral setup, copy the published files into the application's
public directory before building:

```sh
mkdir -p public/postcss-go
cp node_modules/@postcss-go/core/dist/wasm/worker.js public/postcss-go/
cp node_modules/@postcss-go/core/dist/wasm/postcss-go.wasm public/postcss-go/
cp node_modules/@postcss-go/core/dist/wasm/wasm_exec.js public/postcss-go/
```

The package subpath exports can also be fed into a bundler-specific URL loader.
For example, Vite supports:

```ts
import workerUrl from '@postcss-go/core/wasm/worker?url';
import wasmUrl from '@postcss-go/core/wasm/postcss-go.wasm?url';
import wasmExecUrl from '@postcss-go/core/wasm/wasm_exec.js?url';

const processor = createBrowserProcessor([], { workerUrl, wasmUrl, wasmExecUrl });
```

Do not use `new URL('@postcss-go/core/...', import.meta.url)`: the URL
constructor does not resolve npm package exports.

Pass absolute or same-origin URLs through `workerUrl`, `wasmUrl`, and
`wasmExecUrl`. Relative paths resolve against the Worker script URL, not the
page URL.

## CSP and cross-origin isolation

Minimum Content-Security-Policy shape for the Worker path:

- `worker-src` — allow the classic Worker script origin
- `script-src` — allow `wasm_exec.js` and the Worker script
- `wasm-src` / script policy — allow WebAssembly compilation (`'wasm-unsafe-eval'`
  where the browser requires it for `WebAssembly.instantiate`)
- `connect-src` — allow `fetch` of the `.wasm` asset when it is not inlined

Cross-origin isolation (`Cross-Origin-Opener-Policy` /
`Cross-Origin-Embedder-Policy`) is **not required**. The production browser
path uses `postMessage` JSON RPC and does not depend on
`SharedArrayBuffer`.

## SharedArrayBuffer and non-SAB behavior

| Mechanism                    | Used by browser WASM? |
| ---------------------------- | --------------------- |
| `SharedArrayBuffer`          | No                    |
| `Atomics.wait` sync bridging | No                    |
| Async `postMessage` RPC      | Yes                   |

There is no public sync-over-async wait on the browser main thread. Callers that
need synchronous PostCSS-shaped APIs should use Node with the N-API backend.

## Errors

| Error                         | When                                                                                                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WasmWorkerError`             | Missing classic Worker / `workerUrl`, closed service, init/transport failures, optional RPC timeouts, fatal runtime crashes                                                                                            |
| `SyncBackendUnavailableError` | Any explicit `*Sync` API against the WASM Worker backend, or plugin helpers that parse, insert, or stringify CSS (`helpers.postcss.parse`, `Container#append(string)`, `Node#toString()`, `helpers.postcss.stringify`) |
| `CssSyntaxError`              | Rebuilt from the Worker RPC ErrorDTO (`name`, `reason`, `line`, `column`, `source`, `file`, …)                                                                                                                         |

Fatal Worker failures (`runtime-error`, `Worker.onerror`) mark the service closed,
reject pending RPCs, and terminate the Worker. Create a new service to recover.

Optional `requestTimeoutMs` on `BrowserPostcssGoServiceOptions` rejects hung RPCs
with `WasmWorkerError`; omit it to wait indefinitely (the default).
