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
postcss-go input.css -o output.css --engine go --no-map
```

The CLI mirrors [postcss-cli](https://github.com/postcss/postcss-cli) options: glob inputs, `--dir` / `--replace` / `-o`, watch mode, `postcss.config.js`, and `--use` plugin chains.

### Engines

| Engine              | Flag               | When to use                                            |
| ------------------- | ------------------ | ------------------------------------------------------ |
| `postcss` (default) | `--engine postcss` | Plugin chains, custom parsers, source maps             |
| `go`                | `--engine go`      | Parse/stringify through the Go bridge (no plugins yet) |

Set `POSTCSS_GO_ENGINE=go` to default to the Go engine.

## Config

Supports `postcss.config.js` / `.cjs` / `.mjs` via [postcss-load-config](https://github.com/postcss/postcss-load-config), including function configs with `ctx.file` and `ctx.env`.

When using `--engine go`, pass `--no-map` and avoid `map` options in config. Plugin chains and custom parsers are not supported yet.

## Development

```bash
pnpm --filter @postcss-go/cli test
```
