# postcss-go

Node.js API and CLI for `postcss-go`.

This package is the primary JS/TS integration point for:

- local Node.js usage
- bundler integrations
- CLI (`postcss-go`)
- native Node-API integration with the Go engine

## Install

```bash
npm i -D postcss-go
```

A compatible `@postcss-go/native-*` platform package is required at runtime.
Missing native artifacts are reported as backend-unavailable errors; there is
no child-process transport fallback.

## CLI

```bash
postcss-go input.css -o output.css
postcss-go src/**/*.css --base src --dir build
cat input.css | postcss-go -u autoprefixer > output.css
postcss-go input.css -o output.css --no-map
```

The CLI mirrors [postcss-cli](https://github.com/postcss/postcss-cli) options: glob inputs, `--dir` / `--replace` / `-o`, watch mode, `postcss.config.js`, and `--use` plugin chains.

The CLI always uses the Go engine. JS plugin chains run through the
postcss-go-owned plugin runtime before Go parse/stringify and source-map
generation.

## Config

The built-in loader supports `postcss.config.js`, `.cjs`, `.mjs`, and the
equivalent `.postcssrc.*` names without `postcss-load-config`. JSON config is
also supported when it does not need executable plugins.

```ts
import type { PostcssGoConfigExport } from 'postcss-go';

const config: PostcssGoConfigExport = (ctx) => ({
  // Prefer CLI `--map` / `--no-map` when present; otherwise choose by env.
  map: ctx.options.map ?? (ctx.env === 'production' ? { inline: false } : false),
  plugins: {
    autoprefixer: {},
  },
});

export default config;
```

`plugins` accepts an array of plugin instances or an object mapping module IDs
to options (`false` disables an entry and `true` calls the creator without
options). Processing options such as `parser`, `syntax`, `stringifier`, and
`map` may be placed at the top level or under `options`; top-level values win.
Function configs receive a typed `ConfigContext` with `env`, config `cwd`, the
current input's `file` fields, and CLI-derived `options`.

On the CLI, explicit `--map` / `--no-map` override config `map`, and `--use`
replaces only the plugin list while still loading other config options.

Source maps for standard CSS are generated from Go AST locations. Custom
parser, syntax, or stringifier implementations currently throw
`UnsupportedSyntaxError`; the package never falls back to PostCSS.

## Backend reporting

```ts
import postcss, { getBackendCapabilities } from 'postcss-go';

const installed = getBackendCapabilities();
console.log(installed.asynchronous?.backend); // "native" or null

const result = await postcss().process('a { color: red }');
console.log(result.backend); // backend used for this operation: "native"
```

## Browser / WASM

For browsers, use the `postcss-go/wasm` entry. It re-exports the browser
API and ships the classic Worker plus WASM assets:

```ts
import { createBrowserProcessor } from 'postcss-go/wasm';

const processor = createBrowserProcessor([], {
  // Copy these three package assets to your application's public directory.
  workerUrl: '/postcss-go/worker.js',
  wasmUrl: '/postcss-go/postcss-go.wasm',
  wasmExecUrl: '/postcss-go/wasm_exec.js',
});
```

See the website guide page `guide/browser-wasm` for CSP and asset-loading details.
Browser plugins may mutate the hydrated AST; `helpers.postcss.parse`,
`root.append('.a{}')`, `Node#toString()`, and `helpers.postcss.stringify` throw
`SyncBackendUnavailableError`.

`isNativeBridgeAvailable()` is the boolean discovery shortcut. The CLI prints
`Backend: native (native addon available)` with `--verbose`. There is no silent
child-process, WASM, or PostCSS fallback in Node.

## Compatibility boundary

| Area                                 | Supported                                        | Boundary                                                              |
| ------------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------- |
| Config files                         | JS, MJS, CJS, JSON; object or async function     | No `postcss-load-config` search extensions                            |
| Plugins                              | PostCSS-shaped sync and async plugin lifecycle   | Runs on postcss-go-owned AST classes                                  |
| Parser / syntax / stringifier config | Typed and validated                              | Currently rejected with `UnsupportedSyntaxError`                      |
| Source maps                          | Previous maps, inline/external maps, annotations | Generated and composed by Go                                          |
| Node backend                         | Async worker-backed and explicit sync N-API      | Compatible native package is required                                 |
| LazyResult                           | Not supported                                    | `process()` is an explicit Promise; use `processSync()` for sync work |

## Migrating from PostCSS

1. Install `postcss-go` and remove the runtime `postcss`,
   `postcss-load-config`, and `postcss-reporter` dependencies if nothing else
   uses them.
2. Replace the CLI command with `postcss-go`; keep a supported
   `postcss.config.*` file and plugin list.
3. Replace implicit `LazyResult` reads with `await processor.process(...)`, or
   call `processSync(...)` for an entirely synchronous plugin chain.
4. Remove explicit default parser/stringifier delegates. Audit custom syntax
   and custom AST nodes: postcss-go rejects these boundaries instead of
   falling back to PostCSS.
5. Check `getBackendCapabilities()` during startup when native installation is
   optional in your deployment, and inspect `result.backend` in diagnostics.

## Development

```bash
pnpm --filter postcss-go test
pnpm --filter postcss-go test:cli
```
