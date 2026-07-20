# CLI `parseArgs` Design

## Goal

Replace the CLI's `yargs` dependency with Node's built-in `node:util.parseArgs` while preserving the existing command-line behavior and `--help` support.

## Design

`packages/postcss-go/src/args.ts` will declare the supported long and short options directly in a `parseArgs` configuration. Positionals remain in `argv._`; repeated `-u`/`--use` values are collected as an array; `--no-map` remains supported through `allowNegative`; and `--ext` is normalized with a leading dot.

Help text will be maintained as a local usage string. `-h` and `--help` print that text and terminate successfully. Unknown options and missing option values use `parseArgs` errors. Existing yargs-level conflicts and implications (`output`/`dir`/`replace`, `watch`/`replace`, and `ext`/`base` requiring `dir`) will be checked explicitly after parsing.

The package dependency and lockfile entries for `yargs` will be removed. Tests will cover aliases, negated map, repeated plugin options, help output, and validation failures.

## Error handling and compatibility

The parser will continue returning the `CliArgv` shape consumed by the CLI. Help is handled before normal validation. Parser failures will be surfaced as CLI errors by the existing executable path, without introducing another runtime dependency.
