---
layout: ../../layouts/GuideLayout.astro
title: CLI reference
section: cli-reference
---

# CLI reference

`postcss-go` processes CSS files through the Go engine while loading the same
configuration shape used by PostCSS projects.

## At a glance

| Area        | What it does                               | Typical entry                        |
| ----------- | ------------------------------------------ | ------------------------------------ |
| Files       | Process one file, a directory, or a glob   | `postcss-go src/**/*.css --dir dist` |
| Output      | Write a file, directory, or replace inputs | `-o`, `--dir`, `--replace`           |
| Plugins     | Load a PostCSS plugin chain                | `-u autoprefixer`                    |
| Development | Re-run when source files change            | `-w`, `--watch`                      |
| Maps        | Generate or disable source maps            | `--no-map`                           |
| Config      | Point at or discover a config file         | `--config`                           |

## Inputs and output

<div class="mb-12 mt-7 grid gap-[.6rem]">
  <div class="m-0 flex items-center justify-between gap-4 overflow-hidden rounded-[.85rem] border border-white/10 bg-transparent px-4 py-[.9rem]" data-code-sample><code class="min-w-0 overflow-x-auto whitespace-nowrap border-0! bg-transparent! p-0! text-[.86rem] leading-normal text-white">postcss-go input.css -o output.css</code><button class="shrink-0 cursor-pointer rounded-full border border-white/10 bg-transparent px-[.7rem] py-[.35rem] font-mono text-[.68rem] text-white/70 transition-colors duration-150 hover:border-acid hover:text-acid focus-visible:border-acid focus-visible:text-acid focus-visible:outline-none" type="button" data-copy-code>Copy</button></div>
  <div class="m-0 flex items-center justify-between gap-4 overflow-hidden rounded-[.85rem] border border-white/10 bg-transparent px-4 py-[.9rem]" data-code-sample><code class="min-w-0 overflow-x-auto whitespace-nowrap border-0! bg-transparent! p-0! text-[.86rem] leading-normal text-white">postcss-go src/**/*.css --base src --dir build</code><button class="shrink-0 cursor-pointer rounded-full border border-white/10 bg-transparent px-[.7rem] py-[.35rem] font-mono text-[.68rem] text-white/70 transition-colors duration-150 hover:border-acid hover:text-acid focus-visible:border-acid focus-visible:text-acid focus-visible:outline-none" type="button" data-copy-code>Copy</button></div>
  <div class="m-0 flex items-center justify-between gap-4 overflow-hidden rounded-[.85rem] border border-white/10 bg-transparent px-4 py-[.9rem]" data-code-sample><code class="min-w-0 overflow-x-auto whitespace-nowrap border-0! bg-transparent! p-0! text-[.86rem] leading-normal text-white">cat input.css | postcss-go -u autoprefixer &gt; output.css</code><button class="shrink-0 cursor-pointer rounded-full border border-white/10 bg-transparent px-[.7rem] py-[.35rem] font-mono text-[.68rem] text-white/70 transition-colors duration-150 hover:border-acid hover:text-acid focus-visible:border-acid focus-visible:text-acid focus-visible:outline-none" type="button" data-copy-code>Copy</button></div>
  <div class="m-0 flex items-center justify-between gap-4 overflow-hidden rounded-[.85rem] border border-white/10 bg-transparent px-4 py-[.9rem]" data-code-sample><code class="min-w-0 overflow-x-auto whitespace-nowrap border-0! bg-transparent! p-0! text-[.86rem] leading-normal text-white">postcss-go input.css --replace</code><button class="shrink-0 cursor-pointer rounded-full border border-white/10 bg-transparent px-[.7rem] py-[.35rem] font-mono text-[.68rem] text-white/70 transition-colors duration-150 hover:border-acid hover:text-acid focus-visible:border-acid focus-visible:text-acid focus-visible:outline-none" type="button" data-copy-code>Copy</button></div>
</div>

| Option                                    | Description                                                          |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `-o, --output <file>`                     | Write one input to a specific output file.                           |
| `--dir <directory>`                       | Write a directory or glob input to a directory.                      |
| `--replace`                               | Replace input files in place.                                        |
| `--base <directory>`                      | Remove a base path when calculating output paths. Requires `--dir`.  |
| `--ext <extension>`                       | Override the output file extension. Requires `--dir`.                |
| `-w, --watch`                             | Re-process files when they change.                                   |
| `--poll [ms]`                             | Use polling for watch mode; default `100`. Requires `--watch`.       |
| `-m, --map`                               | Write an external source map.                                        |
| `--no-map`                                | Disable source-map output. Explicit map flags win over config `map`. |
| `-u, --use <plugin>`                      | Load a plugin by package name or file path (repeatable).             |
| `--config <path>`                         | Config file or directory to search from.                             |
| `--env <name>`                            | Shortcut for setting `NODE_ENV` for function configs.                |
| `--include-dotfiles`                      | Allow globs to match files and directories that begin with `.`.      |
| `--verbose`                               | Print backend and per-file timing details on stderr.                 |
| `--parser` / `--syntax` / `--stringifier` | Currently rejected with `UnsupportedSyntaxError` before import.      |

## Configuration and plugins

The built-in loader finds `postcss.config.js`, `.cjs`, `.mjs`, `.postcssrc.*`,
or JSON configuration without `postcss-load-config`. A config may export an
object or an async function. Function configs receive `ctx.env`, config
`ctx.cwd`, current `ctx.file` metadata, and CLI-derived `ctx.options`.

Plugins may be an array of instances or an object mapping module IDs to their
options. `map`, `parser`, `syntax`, and `stringifier` are typed configuration
fields, but custom parser/syntax/stringifier delegates are currently rejected
with `UnsupportedSyntaxError`; the CLI never falls back to PostCSS.

Precedence:

- Explicit `--map` / `--no-map` always override config `map` values.
- `-u` / `--use` replaces the config plugin list only. Config `map` and other
  options still load.
- Function configs that need CLI defaults can still read `ctx.options.map`.

<div class="mb-12 mt-7 grid gap-[.6rem]">
  <div class="m-0 flex items-center justify-between gap-4 overflow-hidden rounded-[.85rem] border border-white/10 bg-transparent px-4 py-[.9rem]" data-code-sample><code class="min-w-0 overflow-x-auto whitespace-nowrap border-0! bg-transparent! p-0! text-[.86rem] leading-normal text-white">postcss-go src/**/*.css --dir dist --base src --no-map</code><button class="shrink-0 cursor-pointer rounded-full border border-white/10 bg-transparent px-[.7rem] py-[.35rem] font-mono text-[.68rem] text-white/70 transition-colors duration-150 hover:border-acid hover:text-acid focus-visible:border-acid focus-visible:text-acid focus-visible:outline-none" type="button" data-copy-code>Copy</button></div>
  <div class="m-0 flex items-center justify-between gap-4 overflow-hidden rounded-[.85rem] border border-white/10 bg-transparent px-4 py-[.9rem]" data-code-sample><code class="min-w-0 overflow-x-auto whitespace-nowrap border-0! bg-transparent! p-0! text-[.86rem] leading-normal text-white">postcss-go input.css -u autoprefixer -o output.css</code><button class="shrink-0 cursor-pointer rounded-full border border-white/10 bg-transparent px-[.7rem] py-[.35rem] font-mono text-[.68rem] text-white/70 transition-colors duration-150 hover:border-acid hover:text-acid focus-visible:border-acid focus-visible:text-acid focus-visible:outline-none" type="button" data-copy-code>Copy</button></div>
</div>

## Watch mode

Use `--watch` with a file, directory, or glob, and write somewhere other than
the inputs: combine it with `--dir` or `-o`. `--watch` and `--replace` are
mutually exclusive because in-place writes would re-trigger the watcher.

Use `--verbose` to print the backend selected for processing. Node CLI runs
report `Backend: native (native addon available)` before the first input, and
print the per-file `result.backend` after each finished file.
