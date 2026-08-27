# @postcss-go/core

## 0.0.3

### Patch Changes

- 889ee70: Fix AST compatibility bugs that broke real-world plugins and Windows source map handling:

  - Keep internal AST fields out of `Object.keys()` results so plugins such as Autoprefixer can enumerate node properties safely.
  - Move proxied nodes correctly in `insertAfter`/`insertBefore`, fixing `postcss-nested` when a rule contains multiple `&` blocks.
  - Normalize backslash `SourceMapURL` values on Windows before parsing previous source maps.

## 0.0.2

### Patch Changes

- cb43b81: Add a dedicated Webpack 5 loader that calls `@postcss-go/core` directly without
  depending on the official `postcss` or `postcss-loader` packages. Document it as
  the supported Webpack integration and remove the `postcss-loader` compatibility
  path from `@postcss-go/core`.

## 0.0.1

### Patch Changes

- fcd0b8b: Initial 0.0.1 release of the Go-backed PostCSS engine: Node.js API, CLI, WASM browser entry, and native addons for macOS, Linux glibc, and Windows.
