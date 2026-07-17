# @postcss-go/cli

Command-line interface for [postcss-go](https://github.com/eryue0220/postcss-go), ported from [postcss-cli](https://github.com/postcss/postcss-cli).

## Install

From the monorepo workspace:

```bash
pnpm install
```

Published usage (once released):

```bash
npm i -D @postcss-go/cli postcss
```

## Usage

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

Source maps are generated from Go AST locations. Custom parsers, syntaxes, and stringifiers are not supported by the Go engine.

## Development

```bash
pnpm --filter @postcss-go/cli test
```
