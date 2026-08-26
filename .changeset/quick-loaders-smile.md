---
'@postcss-go/webpack-loader': patch
'@postcss-go/core': patch
---

Add a dedicated Webpack 5 loader that calls `@postcss-go/core` directly without
depending on the official `postcss` or `postcss-loader` packages. Document it as
the supported Webpack integration and remove the `postcss-loader` compatibility
path from `@postcss-go/core`.
