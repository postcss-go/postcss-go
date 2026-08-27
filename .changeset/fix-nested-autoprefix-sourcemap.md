---
'@postcss-go/core': patch
---

Fix AST compatibility bugs that broke real-world plugins and Windows source map handling:

- Keep internal AST fields out of `Object.keys()` results so plugins such as Autoprefixer can enumerate node properties safely.
- Move proxied nodes correctly in `insertAfter`/`insertBefore`, fixing `postcss-nested` when a rule contains multiple `&` blocks.
- Normalize backslash `SourceMapURL` values on Windows before parsing previous source maps.
