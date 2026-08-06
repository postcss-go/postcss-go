---
layout: ../../layouts/GuideLayout.astro
title: Migration and compatibility
section: migration
---

# Migration and compatibility

`@postcss-go/core` keeps the familiar plugin and configuration shapes while
making execution explicit and removing PostCSS from the production dependency
graph.

## Migration checklist

1. Install `@postcss-go/core`. Remove `postcss`, `postcss-load-config`, and
   `postcss-reporter` if no other tool in the project uses them.
2. Replace `postcss` CLI commands with `postcss-go`. Existing JS, MJS, or CJS
   config files can stay when they use the supported contract below.
3. Replace implicit `LazyResult` reads with
   `await postcss(plugins).process(css, options)`. For a fully synchronous chain,
   use `processSync` and keep every plugin callback synchronous.
4. Remove explicit default parser and stringifier delegates. Audit custom
   syntax packages and custom AST node classes before switching.
5. Verify native installation with `getBackendCapabilities()` during startup
   when your deployment treats optional dependencies specially. Record
   `result.backend` in processing diagnostics.

## Compatibility table

| Surface                          | Current contract                                                                            | Migration note                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Plugins                          | PostCSS-shaped creators, packs, visitors, `prepare`, `Once`, and `OnceExit`; sync and async | Plugins receive postcss-go-owned live nodes and helpers       |
| Configuration                    | `.js`, `.mjs`, `.cjs`, `.json`; object or async function                                    | Loaded by postcss-go, not `postcss-load-config`               |
| Context                          | `env`, config `cwd`, input `file`, and CLI `options`                                        | `env` defaults to `NODE_ENV`, then `development`              |
| Maps                             | Boolean/object map options, previous maps, callback annotations, inline/external output     | Go owns generation, composition, and annotations              |
| Custom parser/syntax/stringifier | Publicly typed and validated, currently unsupported                                         | Throws `UnsupportedSyntaxError`; no fallback                  |
| Custom AST nodes                 | Built-in node classes cross native and WASM boundaries                                      | Unknown node types throw `UnsupportedAstNodeError`            |
| Results                          | Explicit `Promise<Result>` or immediate sync `Result`                                       | No implicit `LazyResult` execution                            |
| Node transport                   | Worker-backed async N-API and in-process sync N-API                                         | Missing addon throws a backend-unavailable error              |
| Browser transport                | Worker-backed WASM service                                                                  | Async-only; browser plugin support remains tracked separately |

## Typed standalone config

```ts
import type { PostcssGoConfigExport } from '@postcss-go/core';

const config: PostcssGoConfigExport = (ctx) => ({
  // Prefer CLI `--map` / `--no-map` when present; otherwise choose by env.
  map: ctx.options.map ?? (ctx.env === 'production' ? { inline: false } : false),
  plugins: {
    autoprefixer: {},
  },
});

export default config;
```

Plugins can also be supplied as an array of already-created plugin values.
Process options can be placed at the top level or in `options`; the top level
wins when the same key appears in both locations. On the CLI, explicit
`--map` / `--no-map` still override whatever the config returns, and `--use`
replaces only the plugin list while keeping other config options.
