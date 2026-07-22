# @postcss-go/core

Node.js API and CLI for `postcss-go`.

This package is the primary JS/TS integration point for:

- local Node.js usage
- bundler integrations
- CLI (`postcss-go`)
- binary / IPC bridging to the Go engine

## Install

```bash
npm i -D @postcss-go/core postcss
```

## CLI

```bash
postcss-go input.css -o output.css
postcss-go src/**/*.css --base src --dir build
cat input.css | postcss-go -u autoprefixer > output.css
postcss-go input.css -o output.css --no-map
```

The CLI mirrors [postcss-cli](https://github.com/postcss/postcss-cli) options: glob inputs, `--dir` / `--replace` / `-o`, watch mode, `postcss.config.js`, and `--use` plugin chains.

The CLI always uses the Go engine. JS plugin chains run through the PostCSS runtime before Go parse/stringify and source-map generation.

## Config

Supports `postcss.config.js` / `.cjs` / `.mjs` via [postcss-load-config](https://github.com/postcss/postcss-load-config), including function configs with `ctx.file` and `ctx.env`.

Source maps for standard CSS are generated from Go AST locations. A parser,
syntax, or stringifier that merely delegates to PostCSS's defaults still uses
the Go pipeline; implementations that change parsing or output semantics use
the native PostCSS fallback because arbitrary JavaScript modules cannot run in
the Go bridge.

## Development

```bash
pnpm --filter @postcss-go/core test
pnpm --filter @postcss-go/core test:cli
```
