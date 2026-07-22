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

## Inputs and output

<div class="cli-command-list">
  <div class="cli-command code-sample" data-code-sample><code>postcss-go input.css -o output.css</code><button class="code-sample__copy" type="button" data-copy-code>Copy</button></div>
  <div class="cli-command code-sample" data-code-sample><code>postcss-go src/**/*.css --base src --dir build</code><button class="code-sample__copy" type="button" data-copy-code>Copy</button></div>
  <div class="cli-command code-sample" data-code-sample><code>cat input.css | postcss-go -u autoprefixer &gt; output.css</code><button class="code-sample__copy" type="button" data-copy-code>Copy</button></div>
  <div class="cli-command code-sample" data-code-sample><code>postcss-go input.css --replace</code><button class="code-sample__copy" type="button" data-copy-code>Copy</button></div>
</div>

| Option                | Description                                       |
| --------------------- | ------------------------------------------------- |
| `-o, --output <file>` | Write one input to a specific output file.        |
| `--dir <directory>`   | Write a directory or glob input to a directory.   |
| `--replace`           | Replace input files in place.                     |
| `--base <directory>`  | Remove a base path when calculating output paths. |
| `-w, --watch`         | Re-process files when they change.                |
| `--no-map`            | Disable source-map output.                        |
| `-u, --use <plugin>`  | Load a plugin by package name.                    |

## Configuration and plugins

The CLI loads `postcss.config.js`, `.cjs`, or `.mjs` with
`postcss-load-config`. JavaScript plugins run through the Node compatibility
layer before the Go engine handles parsing, stringifying, and source maps.

<div class="cli-command-list">
  <div class="cli-command code-sample" data-code-sample><code>postcss-go src/**/*.css --dir dist --base src --no-map</code><button class="code-sample__copy" type="button" data-copy-code>Copy</button></div>
  <div class="cli-command code-sample" data-code-sample><code>postcss-go input.css -u autoprefixer -o output.css</code><button class="code-sample__copy" type="button" data-copy-code>Copy</button></div>
</div>

## Watch mode

Use `--watch` with a file, directory, or glob. Combine it with `--dir` for
multi-file projects or `--replace` for in-place development workflows.
